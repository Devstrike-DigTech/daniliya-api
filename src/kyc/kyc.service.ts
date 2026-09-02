import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { KycStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitKycDto } from './dto/kyc.dto';
import { SmileIdService } from './smile-id.service';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smileId: SmileIdService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
  ) {}

  async submit(userId: string, dto: SubmitKycDto, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.kycSubmission.findUnique({
      where: { userId },
    });
    if (existing?.status === KycStatus.VERIFIED) {
      throw new BadRequestException('Your identity is already verified');
    }
    if (
      existing?.status === KycStatus.SUBMITTED ||
      existing?.status === KycStatus.PENDING_MANUAL
    ) {
      throw new BadRequestException('Your KYC is already under review');
    }

    // The payout account must be ours and name-resolved.
    const bankAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.bankAccountId },
    });
    if (!bankAccount || bankAccount.userId !== userId) {
      throw new BadRequestException('Unknown payout account');
    }

    const result = await this.smileId.submit({
      userId,
      firstName: user.firstName,
      lastName: user.lastName,
      idType: dto.idType,
      idNumber: dto.idNumber,
      dob: dto.dob,
    });

    const status = result.decided
      ? result.verified
        ? KycStatus.VERIFIED
        : KycStatus.REJECTED
      : KycStatus.PENDING_MANUAL;

    // Keep the last 4 in the clear for at-a-glance displays, and the full
    // number AES-encrypted so an admin can read it for manual review without it
    // sitting in the DB as plaintext.
    const idNumberLast4 = dto.idNumber.slice(-4);
    const kycFields = {
      status,
      idType: dto.idType,
      idNumberLast4,
      idNumberEnc: this.encryption.encrypt(dto.idNumber),
      dob: dto.dob ?? null,
      govIdUrl: dto.govIdUrl ?? null,
      bankAccountId: bankAccount.id,
      smileIdRef: result.ref,
      reason: result.reason,
    };

    const record = await this.prisma.kycSubmission.upsert({
      where: { userId },
      create: {
        userId,
        ...kycFields,
        verifiedAt: status === KycStatus.VERIFIED ? new Date() : null,
      },
      update: {
        ...kycFields,
        submittedAt: new Date(),
        rejectedAt: null,
        verifiedAt: status === KycStatus.VERIFIED ? new Date() : null,
      },
    });

    // Keep the affiliate profile's denormalised KYC flag in step with the
    // submission (the admin list reads it), so a Smile-auto-decision shows.
    await this.prisma.affiliateProfile.updateMany({
      where: { userId },
      data: {
        kycStatus: status,
        kycVerifiedAt: status === KycStatus.VERIFIED ? new Date() : null,
        kycRejectedReason: status === KycStatus.REJECTED ? result.reason ?? null : null,
      },
    });

    await this.audit.record({
      actorId: userId,
      action: 'Submitted KYC',
      targetType: 'KycSubmission',
      targetId: record.id,
      after: { status: record.status },
      ip,
    });

    return this.present(record);
  }

  async mine(userId: string) {
    const record = await this.prisma.kycSubmission.findUnique({
      where: { userId },
      include: {
        bankAccount: { select: { bankName: true, accountName: true } },
      },
    });
    if (!record) {
      return { status: KycStatus.PENDING, submitted: false };
    }
    // Identity summary for the portal's KYC card. Only non-sensitive
    // fragments are exposed: the last four digits (already all that is
    // stored) and the uploaded document's file name — never a full number.
    const govIdName = record.govIdUrl
      ? decodeURIComponent(record.govIdUrl.split('/').pop() ?? '').split('?')[0] ||
        null
      : null;
    return {
      ...this.present(record),
      bankAccount: record.bankAccount,
      identity: {
        idType: record.idType,
        idNumberLast4: record.idNumberLast4,
        ninLast4: record.ninLast4,
        bvnLast4: record.bvnLast4,
        govIdType: record.govIdType,
        govIdName,
        dob: record.dob,
      },
    };
  }

  /** Admin decision. Used in stub mode and for Smile ID's manual-review cases. */
  async review(
    adminId: string,
    id: string,
    decision: 'approve' | 'reject',
    reason?: string,
    ip?: string,
  ) {
    const record = await this.prisma.kycSubmission.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException('KYC submission not found');
    if (record.status === KycStatus.VERIFIED) {
      throw new BadRequestException('Already verified');
    }
    if (decision === 'reject' && !reason?.trim()) {
      throw new BadRequestException('A reason is required when rejecting');
    }

    const approved = decision === 'approve';
    const updated = await this.prisma.kycSubmission.update({
      where: { id },
      data: {
        status: approved ? KycStatus.VERIFIED : KycStatus.REJECTED,
        reason: approved ? null : reason,
        verifiedAt: approved ? new Date() : null,
        rejectedAt: approved ? null : new Date(),
      },
    });

    // Keep the affiliate profile's denormalised KYC flag in step.
    await this.prisma.affiliateProfile.updateMany({
      where: { userId: record.userId },
      data: {
        kycStatus: updated.status,
        kycVerifiedAt: approved ? new Date() : null,
        kycRejectedReason: approved ? null : reason,
      },
    });

    await this.audit.record({
      actorId: adminId,
      action: approved ? 'Approved KYC' : 'Rejected KYC',
      targetType: 'KycSubmission',
      targetId: id,
      before: { status: record.status },
      after: { status: updated.status, reason: updated.reason },
      ip,
    });

    return this.present(updated);
  }

  async listForReview(status?: KycStatus) {
    const rows = await this.prisma.kycSubmission.findMany({
      where: {
        status: status ?? {
          in: [KycStatus.SUBMITTED, KycStatus.PENDING_MANUAL],
        },
      },
      orderBy: { submittedAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
        bankAccount: { select: { bankName: true, accountName: true } },
      },
    });

    // The full ID number is decrypted here so the admin can manually verify it;
    // it is exposed only on this admin-guarded review endpoint.
    return rows.map(({ idNumberEnc, ...row }) => ({
      ...row,
      idNumber: this.encryption.decrypt(idNumberEnc),
    }));
  }

  /** True only when identity is verified — the gate every payout checks. */
  async isVerified(userId: string): Promise<boolean> {
    const record = await this.prisma.kycSubmission.findUnique({
      where: { userId },
      select: { status: true },
    });
    return record?.status === KycStatus.VERIFIED;
  }

  private present(record: {
    id: string;
    status: KycStatus;
    govIdType: string | null;
    reason: string | null;
    submittedAt: Date;
    verifiedAt: Date | null;
  }) {
    return {
      id: record.id,
      status: record.status,
      govIdType: record.govIdType,
      reason: record.reason,
      submitted: true,
      submittedAt: record.submittedAt,
      verifiedAt: record.verifiedAt,
    };
  }
}
