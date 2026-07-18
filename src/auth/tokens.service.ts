import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { RedisService } from '../redis/redis.service';

/** `ms`-style duration ("15m", "7d") as @nestjs/jwt types it. */
type ExpiresIn = JwtSignOptions['expiresIn'];

export interface JwtPayload {
  sub: string;
  email: string | null;
  role: string;
  jti?: string;
}

/**
 * Issues access + refresh tokens.
 *
 * Refresh tokens are rotated: each refresh mints a new jti and revokes the old
 * one. Valid jtis live in Redis (`refresh:<userId>:<jti>`) so a token can be
 * revoked server-side on logout or reuse.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  private refreshKey(userId: string, jti: string) {
    return `refresh:${userId}:${jti}`;
  }

  async issue(payload: Omit<JwtPayload, 'jti'>) {
    const jti = randomUUID();

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.getOrThrow<string>(
        'JWT_ACCESS_EXPIRES_IN',
      ) as ExpiresIn,
    });

    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.getOrThrow<string>(
          'JWT_REFRESH_EXPIRES_IN',
        ) as ExpiresIn,
      },
    );

    await this.redis.set(
      this.refreshKey(payload.sub, jti),
      '1',
      this.refreshTtlSeconds(),
    );

    return { accessToken, refreshToken };
  }

  /** Verifies a refresh token, revokes its jti, and issues a fresh pair. */
  async rotate(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!payload.jti) throw new UnauthorizedException('Invalid refresh token');

    const key = this.refreshKey(payload.sub, payload.jti);
    if (!(await this.redis.exists(key))) {
      // Token was already used or revoked — treat as compromised.
      await this.revokeAll(payload.sub);
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    await this.redis.del(key);

    return this.issue({
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    });
  }

  async revoke(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (payload.jti) {
        await this.redis.del(this.refreshKey(payload.sub, payload.jti));
      }
    } catch {
      // Already invalid — logout is idempotent.
    }
  }

  async revokeAll(userId: string) {
    const keys = await this.redis.keys(`refresh:${userId}:*`);
    await Promise.all(keys.map((k) => this.redis.del(k)));
  }

  private refreshTtlSeconds(): number {
    const raw = this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN');
    const match = /^(\d+)([smhd])$/.exec(raw.trim());
    if (!match) return 7 * 24 * 3600;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1;
    return value * multiplier;
  }
}
