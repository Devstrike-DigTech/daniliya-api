import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomInt, randomUUID } from 'crypto';
import { MailService } from '../notifications/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import { TokensService } from './tokens.service';

const BCRYPT_ROUNDS = 12;
const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const OTP_RESEND_COOLDOWN_SECONDS = 50; // matches the 50s resend timer in the portals
const RESET_TTL_SECONDS = 60 * 60; // 1 hour

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: TokensService,
    private readonly mail: MailService,
  ) {}

  // ── Registration & verification ───────────────────────────────────────

  async register(dto: RegisterDto) {
    const email = this.normalizeEmail(dto.email);

    const existing = await this.prisma.user.findUnique({ where: { email } });

    // A GUEST row is a buyer who checked out without registering. It holds their
    // orders but has no password, so registering with the same email claims it
    // in place — the history carries over instead of being orphaned.
    const claiming = existing !== null && existing.password === null;
    if (existing && !claiming) {
      throw new ConflictException('An account with this email already exists');
    }

    const password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = claiming
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            phone: dto.phone,
            firstName: dto.firstName,
            lastName: dto.lastName,
            password,
            status: UserStatus.PENDING_VERIFICATION,
          },
        })
      : await this.prisma.user.create({
          data: {
            email,
            phone: dto.phone,
            firstName: dto.firstName,
            lastName: dto.lastName,
            password,
            status: UserStatus.PENDING_VERIFICATION,
          },
        });

    await this.sendOtp(user);

    return {
      id: user.id,
      email: user.email,
      status: user.status,
      claimedGuestOrders: claiming,
      message: claiming
        ? 'Account created. Your previous orders are now linked — check your email for a 6-digit code.'
        : 'Account created. Check your email for a 6-digit code.',
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.findByEmailOrThrow(email);

    if (user.status === UserStatus.ACTIVE) {
      throw new BadRequestException('Account is already verified');
    }

    // NOTE: RedisService.get() JSON-parses values, so an all-digit code comes
    // back as a number — compare as strings.
    const stored = await this.redis.get<string | number>(this.otpKey(user.id));
    if (stored === null) {
      throw new BadRequestException('Code has expired — request a new one');
    }
    if (String(stored) !== dto.code) {
      throw new BadRequestException('Invalid code');
    }

    await this.redis.del(this.otpKey(user.id));

    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: { status: UserStatus.ACTIVE },
    });

    return this.issueFor(verified);
  }

  async resendOtp(email: string) {
    const user = await this.findByEmailOrThrow(this.normalizeEmail(email));

    if (user.status === UserStatus.ACTIVE) {
      throw new BadRequestException('Account is already verified');
    }

    const cooldownKey = `otp:cooldown:${user.id}`;
    if (await this.redis.exists(cooldownKey)) {
      throw new BadRequestException(
        'Please wait before requesting another code',
      );
    }

    await this.sendOtp(user);
    return { message: 'A new code has been sent.' };
  }

  // ── Login / session ───────────────────────────────────────────────────

  async login(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Same error for unknown email and wrong password — don't leak which.
    if (
      !user?.password ||
      !(await bcrypt.compare(dto.password, user.password))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('This account has been suspended');
    }
    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new UnauthorizedException('Verify your email before signing in');
    }

    return this.issueFor(user);
  }

  async refresh(refreshToken: string) {
    return this.tokens.rotate(refreshToken);
  }

  async logout(refreshToken: string) {
    await this.tokens.revoke(refreshToken);
    return { message: 'Signed out.' };
  }

  // ── Password ──────────────────────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always return the same response — never reveal whether an account exists.
    if (user) {
      const token = randomUUID();
      await this.redis.set(this.resetKey(token), user.id, RESET_TTL_SECONDS);
      await this.mail.sendPasswordReset(email, token);
    }

    return {
      message: 'If that email is registered, a reset link is on its way.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const userId = await this.redis.get<string>(this.resetKey(dto.token));
    if (!userId) {
      throw new BadRequestException(
        'This reset link is invalid or has expired',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS) },
    });

    await this.redis.del(this.resetKey(dto.token));
    // Password changed — force re-login everywhere.
    await this.tokens.revokeAll(userId);

    return { message: 'Password updated. Sign in with your new password.' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.password) throw new NotFoundException('User not found');

    if (!(await bcrypt.compare(dto.currentPassword, user.password))) {
      throw new BadRequestException('Current password is incorrect');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS) },
    });

    await this.tokens.revokeAll(userId);
    return { message: 'Password changed. Please sign in again.' };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async sendOtp(user: User) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis.set(this.otpKey(user.id), code, OTP_TTL_SECONDS);
    await this.redis.set(
      `otp:cooldown:${user.id}`,
      '1',
      OTP_RESEND_COOLDOWN_SECONDS,
    );
    if (user.email) await this.mail.sendOtp(user.email, code);
  }

  private async issueFor(user: User) {
    const tokens = await this.tokens.issue({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
      },
    };
  }

  private async findByEmailOrThrow(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('No account found for that email');
    return user;
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private otpKey(userId: string) {
    return `otp:${userId}`;
  }

  private resetKey(token: string) {
    return `pwreset:${token}`;
  }
}
