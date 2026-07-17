import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminRole, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ensures a SUPERADMIN exists on boot (from ADMIN_EMAIL) so the platform is
 * usable without touching the database directly. Idempotent.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const email = this.config.get<string>('ADMIN_EMAIL')?.trim().toLowerCase();
    if (!email) return;

    const existing = await this.prisma.user.findUnique({
      where: { email },
      include: { adminProfile: true },
    });

    if (existing) {
      if (!existing.adminProfile) {
        await this.prisma.$transaction([
          this.prisma.user.update({ where: { id: existing.id }, data: { role: UserRole.ADMIN } }),
          this.prisma.adminProfile.create({ data: { userId: existing.id, role: AdminRole.SUPERADMIN } }),
        ]);
        this.logger.log(`Promoted ${email} to SUPERADMIN`);
      }
      return;
    }

    // First boot: create the superadmin. They set their password via reset.
    const tempPassword = randomBytes(16).toString('hex');
    await this.prisma.user.create({
      data: {
        email,
        firstName: 'Daniliya',
        lastName: 'Admin',
        password: await bcrypt.hash(tempPassword, 12),
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        adminProfile: { create: { role: AdminRole.SUPERADMIN } },
      },
    });
    this.logger.warn(
      `Seeded SUPERADMIN ${email} — use "forgot password" to set a password before first login.`,
    );
  }
}
