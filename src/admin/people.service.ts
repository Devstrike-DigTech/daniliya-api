import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AffiliateTier, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../notifications/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeTierDto, MessageUserDto, RejectDto } from './dto/admin.dto';

/**
 * People moderation. Two independent axes:
 *  - application decision (approve/reject) → profile.isApproved / rejectedReason
 *  - account standing (suspend/reinstate)  → user.status
 */
@Injectable()
export class AdminPeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ── Affiliates ────────────────────────────────────────────────────────

  affiliates(q?: string) {
    return this.prisma.affiliateProfile.findMany({
      where: q
        ? {
            user: {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            },
          }
        : undefined,
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
  }

  async affiliate(id: string) {
    const p = await this.prisma.affiliateProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            status: true,
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Affiliate not found');
    return p;
  }

  async changeTier(
    id: string,
    dto: ChangeTierDto,
    adminId: string,
    ip?: string,
  ) {
    const p = await this.affiliate(id);
    const updated = await this.prisma.affiliateProfile.update({
      where: { id },
      data: { tier: dto.tier },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'Changed affiliate tier',
      targetType: 'AffiliateProfile',
      targetId: id,
      before: { tier: p.tier },
      after: { tier: dto.tier },
      ip,
    });
    return updated;
  }

  // ── Influencers ───────────────────────────────────────────────────────

  influencers(q?: string) {
    return this.prisma.influencerProfile.findMany({
      where: q
        ? {
            user: {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            },
          }
        : undefined,
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
  }

  async influencer(id: string) {
    const p = await this.prisma.influencerProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            status: true,
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Influencer not found');
    return p;
  }

  approveInfluencer(id: string, adminId: string, ip?: string) {
    return this.decideInfluencer(id, true, undefined, adminId, ip);
  }
  rejectInfluencer(id: string, dto: RejectDto, adminId: string, ip?: string) {
    return this.decideInfluencer(id, false, dto.reason, adminId, ip);
  }

  private async decideInfluencer(
    id: string,
    approve: boolean,
    reason: string | undefined,
    adminId: string,
    ip?: string,
  ) {
    const p = await this.prisma.influencerProfile.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Influencer not found');
    const updated = await this.prisma.influencerProfile.update({
      where: { id },
      data: {
        isApproved: approve,
        approvedAt: approve ? new Date() : null,
        rejectedReason: approve ? null : (reason ?? 'Not approved'),
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: approve ? 'Approved influencer' : 'Rejected influencer',
      targetType: 'InfluencerProfile',
      targetId: id,
      after: { isApproved: approve },
      ip,
    });
    return updated;
  }

  // ── Vendors ───────────────────────────────────────────────────────────

  vendors(q?: string) {
    return this.prisma.vendorProfile.findMany({
      where: q
        ? {
            OR: [
              { businessName: { contains: q, mode: 'insensitive' } },
              { user: { email: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : undefined,
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
  }

  async vendor(id: string) {
    const p = await this.prisma.vendorProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            status: true,
          },
        },
        _count: { select: { products: true, reviews: true } },
      },
    });
    if (!p) throw new NotFoundException('Vendor not found');
    return p;
  }

  approveVendor(id: string, adminId: string, ip?: string) {
    return this.decideVendor(id, true, undefined, adminId, ip);
  }
  rejectVendor(id: string, dto: RejectDto, adminId: string, ip?: string) {
    return this.decideVendor(id, false, dto.reason, adminId, ip);
  }

  private async decideVendor(
    id: string,
    approve: boolean,
    reason: string | undefined,
    adminId: string,
    ip?: string,
  ) {
    const p = await this.prisma.vendorProfile.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Vendor not found');
    const updated = await this.prisma.vendorProfile.update({
      where: { id },
      data: {
        isApproved: approve,
        approvedAt: approve ? new Date() : null,
        rejectedReason: approve ? null : (reason ?? 'Not approved'),
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: approve ? 'Approved vendor' : 'Rejected vendor',
      targetType: 'VendorProfile',
      targetId: id,
      after: { isApproved: approve },
      ip,
    });
    return updated;
  }

  // ── Standing (works for any role, by userId) ──────────────────────────

  suspend(userId: string, adminId: string, ip?: string) {
    return this.setStanding(userId, UserStatus.SUSPENDED, adminId, ip);
  }
  reinstate(userId: string, adminId: string, ip?: string) {
    return this.setStanding(userId, UserStatus.ACTIVE, adminId, ip);
  }

  private async setStanding(
    userId: string,
    to: UserStatus,
    adminId: string,
    ip?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new BadRequestException('User has not verified their account');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: to },
    });
    await this.audit.record({
      actorId: adminId,
      action:
        to === UserStatus.SUSPENDED ? 'Suspended user' : 'Reinstated user',
      targetType: 'User',
      targetId: userId,
      before: { status: user.status },
      after: { status: to },
      ip,
    });
    return { userId, status: to };
  }

  async message(
    userId: string,
    dto: MessageUserDto,
    adminId: string,
    ip?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email) throw new NotFoundException('User not found');
    await this.mail.sendNotice(user.email, dto.subject, dto.body);
    await this.audit.record({
      actorId: adminId,
      action: 'Messaged user',
      targetType: 'User',
      targetId: userId,
      after: { subject: dto.subject },
      ip,
    });
    return { sent: true };
  }
}
