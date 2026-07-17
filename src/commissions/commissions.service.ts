import { Injectable, Logger } from '@nestjs/common';
import {
  BeneficiaryType,
  CommissionStatus,
  OrderStatus,
  Prisma,
  PayoutModel,
  SubmissionStatus,
} from '@prisma/client';
import { PRICING } from '../config/pricing';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Turns an attributed, paid order into commission records.
 *
 * - Affiliate: flat ₦10,000 per confirmed sale (PRICING.AFFILIATE_COMMISSION).
 * - Influencer: CPA per campaign — FLAT amount, or a % of subtotal.
 *
 * Idempotent: the (orderId, beneficiaryId) unique key means accruing twice for
 * the same order never double-pays. See docs/04-business-rules.md §3–4.
 */
@Injectable()
export class CommissionsService {
  private readonly logger = new Logger(CommissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async accrueForOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return;

    await this.accrueAffiliate(order);
    await this.accrueInfluencer(order);
  }

  private async accrueAffiliate(order: { id: string; affiliateCode: string | null }) {
    if (!order.affiliateCode) return;

    const affiliate = await this.prisma.affiliateProfile.findUnique({
      where: { referralCode: order.affiliateCode },
    });
    if (!affiliate || !affiliate.isActive) return;

    await this.upsertCommission(
      order.id,
      affiliate.userId,
      BeneficiaryType.AFFILIATE,
      PRICING.AFFILIATE_COMMISSION,
    );
    this.logger.log(`Affiliate commission accrued for order ${order.id}`);
  }

  private async accrueInfluencer(order: {
    id: string;
    promoCode: string | null;
    influencerCode: string | null;
    subtotal: Prisma.Decimal;
  }) {
    // Prefer a promo code (carries campaign context); fall back to a raw code.
    let influencerUserId: string | null = null;
    let campaignId: string | null = null;

    if (order.promoCode) {
      const promo = await this.prisma.promoCode.findUnique({
        where: { code: order.promoCode },
        include: { influencer: true },
      });
      if (promo?.influencer && promo.isActive) {
        influencerUserId = promo.influencer.userId;
        campaignId = promo.campaignId;
        await this.prisma.promoCode.update({
          where: { id: promo.id },
          data: { usageCount: { increment: 1 } },
        });
      }
    } else if (order.influencerCode) {
      const inf = await this.prisma.influencerProfile.findUnique({
        where: { influencerCode: order.influencerCode },
        include: { campaignAssignments: { orderBy: { assignedAt: 'desc' }, take: 1 } },
      });
      if (inf?.isApproved) {
        influencerUserId = inf.userId;
        campaignId = inf.campaignAssignments[0]?.campaignId ?? null;
      }
    }

    if (!influencerUserId) return;

    const amount = await this.influencerAmount(campaignId, order.subtotal);
    if (amount.lte(0)) return;

    await this.upsertCommission(order.id, influencerUserId, BeneficiaryType.INFLUENCER, amount);
    this.logger.log(`Influencer commission accrued for order ${order.id}`);
  }

  private async influencerAmount(
    campaignId: string | null,
    subtotal: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    if (!campaignId) return new Prisma.Decimal(0);
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return new Prisma.Decimal(0);

    if (campaign.payoutModel === PayoutModel.FLAT) {
      return campaign.flatAmount ?? new Prisma.Decimal(0);
    }
    // COMMISSION: percentage of order subtotal.
    const rate = campaign.commissionRate ?? new Prisma.Decimal(0);
    return subtotal.times(rate).dividedBy(100);
  }

  private upsertCommission(
    orderId: string,
    beneficiaryId: string,
    beneficiaryType: BeneficiaryType,
    amount: Prisma.Decimal,
  ) {
    return this.prisma.commissionRecord.upsert({
      where: { orderId_beneficiaryId: { orderId, beneficiaryId } },
      create: { orderId, beneficiaryId, beneficiaryType, amount, status: CommissionStatus.PENDING },
      // Never overwrite an already-progressed commission (confirmed/disbursed).
      update: {},
    });
  }

  /**
   * Refund/cancel: reverse commissions not yet disbursed. A commission that was
   * already CONFIRMED/QUEUED was credited to the wallet, so its credit is
   * clawed back with a matching DEBIT.
   */
  async voidForOrder(orderId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const records = await db.commissionRecord.findMany({
      where: {
        orderId,
        status: { in: [CommissionStatus.PENDING, CommissionStatus.CONFIRMED, CommissionStatus.QUEUED] },
      },
    });

    for (const c of records) {
      if (c.status !== CommissionStatus.PENDING) {
        await this.ledger.debit(c.beneficiaryId, c.amount, 'commission-void', c.id, db);
      }
      await db.commissionRecord.update({
        where: { id: c.id },
        data: { status: CommissionStatus.VOIDED },
      });
    }
  }

  /**
   * Promote PENDING commissions to CONFIRMED and credit the beneficiary's
   * wallet. Only commissions on non-refunded orders qualify; influencer
   * commissions additionally require an APPROVED post submission with #ad.
   * Returns the number confirmed.
   */
  async confirmEligible(): Promise<number> {
    const pending = await this.prisma.commissionRecord.findMany({
      where: { status: CommissionStatus.PENDING },
      include: { order: { select: { status: true, promoCode: true } } },
    });

    let confirmed = 0;
    for (const c of pending) {
      if (
        c.order.status === OrderStatus.CANCELLED ||
        c.order.status === OrderStatus.REFUNDED
      ) {
        continue;
      }
      if (c.beneficiaryType === BeneficiaryType.INFLUENCER) {
        if (!(await this.influencerHasApprovedPost(c.beneficiaryId, c.order.promoCode))) {
          continue; // not payout-eligible yet
        }
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.commissionRecord.update({
          where: { id: c.id },
          data: { status: CommissionStatus.CONFIRMED, confirmedAt: new Date() },
        });
        await this.ledger.credit(c.beneficiaryId, c.amount, 'commission', c.id, tx);
      });
      confirmed++;
    }
    return confirmed;
  }

  /** Influencer payout eligibility: an approved, #ad-disclosed post for the campaign. */
  private async influencerHasApprovedPost(
    beneficiaryUserId: string,
    promoCode: string | null,
  ): Promise<boolean> {
    if (!promoCode) return false;
    const promo = await this.prisma.promoCode.findUnique({ where: { code: promoCode } });
    if (!promo?.campaignId) return false;

    const influencer = await this.prisma.influencerProfile.findUnique({
      where: { userId: beneficiaryUserId },
    });
    if (!influencer) return false;

    const approved = await this.prisma.campaignSubmission.findFirst({
      where: {
        status: SubmissionStatus.APPROVED,
        hasAdDisclosure: true,
        assignment: { campaignId: promo.campaignId, influencerId: influencer.id },
      },
    });
    return !!approved;
  }
}
