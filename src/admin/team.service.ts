import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminRole, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../notifications/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeRoleDto, InviteTeammateDto } from './dto/admin.dto';

/** Team management is SUPERADMIN-only (a finer grain than the ADMIN role guard). */
@Injectable()
export class AdminTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async list() {
    const rows = await this.prisma.adminProfile.findMany({
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((a) => ({
      id: a.id,
      name: `${a.user.firstName} ${a.user.lastName}`,
      email: a.user.email,
      role: a.role,
      status: a.user.status,
      lastActive: a.lastActive,
    }));
  }

  async invite(actingAdminId: string, dto: InviteTeammateDto, ip?: string) {
    await this.assertSuperadmin(actingAdminId);

    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException('A user with this email already exists');
    }

    // Create with a random password; the invitee sets their own via password reset.
    const tempPassword = randomBytes(16).toString('hex');
    const user = await this.prisma.user.create({
      data: {
        email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        password: await bcrypt.hash(tempPassword, 12),
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        adminProfile: { create: { role: dto.role } },
      },
    });

    await this.mail.sendNotice(
      email,
      'You have been invited to the Daniliya admin',
      `You've been added as ${dto.role}. Use "Forgot password" on the admin sign-in page to set your password and log in.`,
    );
    await this.audit.record({
      actorId: actingAdminId,
      action: 'Invited teammate',
      targetType: 'AdminProfile',
      targetId: user.id,
      after: { email, role: dto.role },
      ip,
    });
    return { id: user.id, email, role: dto.role, invited: true };
  }

  async changeRole(
    actingAdminId: string,
    adminProfileId: string,
    dto: ChangeRoleDto,
    ip?: string,
  ) {
    await this.assertSuperadmin(actingAdminId);
    const profile = await this.prisma.adminProfile.findUnique({
      where: { id: adminProfileId },
    });
    if (!profile) throw new NotFoundException('Team member not found');
    const updated = await this.prisma.adminProfile.update({
      where: { id: adminProfileId },
      data: { role: dto.role },
    });
    await this.audit.record({
      actorId: actingAdminId,
      action: 'Changed teammate role',
      targetType: 'AdminProfile',
      targetId: adminProfileId,
      before: { role: profile.role },
      after: { role: dto.role },
      ip,
    });
    return updated;
  }

  async remove(actingAdminId: string, adminProfileId: string, ip?: string) {
    await this.assertSuperadmin(actingAdminId);
    const profile = await this.prisma.adminProfile.findUnique({
      where: { id: adminProfileId },
    });
    if (!profile) throw new NotFoundException('Team member not found');
    if (profile.userId === actingAdminId)
      throw new BadRequestException('You cannot remove yourself');

    await this.prisma.$transaction([
      this.prisma.adminProfile.delete({ where: { id: adminProfileId } }),
      this.prisma.user.update({
        where: { id: profile.userId },
        data: { role: UserRole.CUSTOMER },
      }),
    ]);
    await this.audit.record({
      actorId: actingAdminId,
      action: 'Removed teammate',
      targetType: 'AdminProfile',
      targetId: adminProfileId,
      ip,
    });
    return { removed: true };
  }

  private async assertSuperadmin(userId: string) {
    const profile = await this.prisma.adminProfile.findUnique({
      where: { userId },
    });
    if (profile?.role !== AdminRole.SUPERADMIN) {
      throw new ForbiddenException('Only a superadmin can manage the team');
    }
  }
}
