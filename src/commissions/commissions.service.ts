import { Injectable, Logger } from '@nestjs/common';
import {
  BeneficiaryType,
  CommissionStatus,
  OrderStatus,
  Prisma,
  PayoutModel,
  SubmissionStatus,
} from '@prisma/client';
import { PlatformConfigService } from '../config/platform-config.service';
import { LedgerService } from '../ledger/ledger.service';
import { MailService } from '../notifications/mail.service';
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
    private readonly config: PlatformConfigService,
    private readonly mail: MailService,
  ) {}

  async accrueForOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) return;

    await this.accrueAffiliate(order);
    await this.accrueInfluencer(order);
    await this.accrueVendors(orderId);
  }

  /**
   * Vendor net per order: each vendor is paid their items' total minus the
   * platform take-rate. Platform-owned products (no vendorId) accrue nothing.
   */
  private async accrueVendors(orderId: string) {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId },
      include: { product: { select: { vendorId: true } } },
    });

    // Sum item totals per vendor profile — on the seller's BASE price, not the
    // customer-facing price, so any ADD_ON commission markup accrues to the
    // platform rather than inflating the vendor's payout.
    const byVendor = new Map<string, Prisma.Decimal>();
    for (const it of items) {
      const vid = it.product.vendorId;
      if (!vid) continue;
      const base = (it.baseUnitPrice ?? it.unitPrice).times(it.quantity);
      byVendor.set(
        vid,
        (byVendor.get(vid) ?? new Prisma.Decimal(0)).plus(base),
      );
    }
    if (byVendor.size === 0) return;

    for (const [vendorId, gross] of byVendor) {
      const vendor = await this.prisma.vendorProfile.findUnique({
        where: { id: vendorId },
      });
      if (!vendor) continue;
      const keepBps = 10000 - vendor.takeRateBps;
      const net = gross.times(keepBps).dividedBy(10000);
      if (net.lte(0)) continue;
      await this.upsertCommission(
        orderId,
        vendor.userId,
        BeneficiaryType.VENDOR,
        net,
      );
    }
    this.logger.log(`Vendor commissions accrued for order ${orderId}`);
  }

  private async accrueAffiliate(order: {
    id: string;
    affiliateCode: string | null;
  }) {
    if (!order.affiliateCode) return;

    const affiliate = await this.prisma.affiliateProfile.findUnique({
      where: { referralCode: order.affiliateCode },
    });
    if (!affiliate || !affiliate.isActive) return;

    // Pay the flat fee per eligible unit sold: a referral order for 3 books
    // earns 3 × the fee. Only products opted into the affiliate programme count.
    const eligibleItems = await this.prisma.orderItem.findMany({
      where: { orderId: order.id, product: { affiliateEligible: true } },
      select: { quantity: true },
    });
    const units = eligibleItems.reduce((sum, i) => sum + i.quantity, 0);
    if (units === 0) return;

    const commission = this.config.getDecimal('AFFILIATE_COMMISSION').times(units);

    // Only e-mail on a genuinely new commission — accrual can re-run for the same
    // order (e.g. POD confirm then a webhook) and the upsert is a no-op then.
    const already = await this.prisma.commissionRecord.findUnique({
      where: {
        orderId_beneficiaryId: { orderId: order.id, beneficiaryId: affiliate.userId },
      },
      select: { id: true },
    });

    await this.upsertCommission(
      order.id,
      affiliate.userId,
      BeneficiaryType.AFFILIATE,
      commission,
    );
    this.logger.log(
      `Affiliate commission accrued for order ${order.id} (${units} unit(s))`,
    );

    if (!already) await this.notifyAffiliateSale(affiliate.userId, order.id, commission, units);
  }

  /** Tell the affiliate a sale came through their link. Never blocks accrual. */
  private async notifyAffiliateSale(
    userId: string,
    orderId: string,
    amount: Prisma.Decimal,
    units: number,
  ) {
    try {
      const [user, order] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
        this.prisma.order.findUnique({ where: { id: orderId }, select: { ref: true } }),
      ]);
      if (user?.email && order) {
        await this.mail.sendAffiliateSale(user.email, {
          ref: order.ref,
          amount: amount.toString(),
          units,
        });
        this.logger.log(
          `Affiliate sale email sent to ${user.email} for order ${order.ref}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to email affiliate ${userId} about a sale`,
        err instanceof Error ? err.stack : String(err),
      );
    }
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
        include: {
          campaignAssignments: { orderBy: { assignedAt: 'desc' }, take: 1 },
        },
      });
      if (inf?.isApproved) {
        influencerUserId = inf.userId;
        campaignId = inf.campaignAssignments[0]?.campaignId ?? null;
      }
    }

    if (!influencerUserId) return;

    // Only pay the creator when the order carries an influencer-eligible product.
    const eligible = await this.prisma.orderItem.count({
      where: { orderId: order.id, product: { influencerEligible: true } },
    });
    if (eligible === 0) return;

    const amount = await this.influencerAmount(campaignId, order.subtotal);
    if (amount.lte(0)) return;

    await this.upsertCommission(
      order.id,
      influencerUserId,
      BeneficiaryType.INFLUENCER,
      amount,
    );

    // Count the sale against the creator's assignment. Without this,
    // CampaignAssignment.conversions stays 0 forever even though it is what the
    // creator's campaign card and the admin campaign detail both display — a
    // creator would see "0 conversions" on a campaign they had just earned on.
    if (campaignId) {
      await this.prisma.campaignInfluencerAssignment.updateMany({
        where: { campaignId, influencer: { userId: influencerUserId } },
        data: { conversions: { increment: 1 } },
      });
    }

    this.logger.log(`Influencer commission accrued for order ${order.id}`);
  }

  private async influencerAmount(
    campaignId: string | null,
    subtotal: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    if (!campaignId) return new Prisma.Decimal(0);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
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
      create: {
        orderId,
        beneficiaryId,
        beneficiaryType,
        amount,
        status: CommissionStatus.PENDING,
      },
      // Never overwrite an already-progressed commission (confirmed/disbursed).
      update: {},
    });
  }

  /**
   * Refund/cancel: reverse commissions not yet disbursed. A commission that was
   * already CONFIRMED/QUEUED was credited to the wallet, so its credit is
   * clawed back with a matching DEBIT.
   */
  async voidForOrder(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const records = await db.commissionRecord.findMany({
      where: {
        orderId,
        status: {
          in: [
            CommissionStatus.PENDING,
            CommissionStatus.CONFIRMED,
            CommissionStatus.QUEUED,
          ],
        },
      },
    });

    for (const c of records) {
      if (c.status !== CommissionStatus.PENDING) {
        await this.ledger.debit(
          c.beneficiaryId,
          c.amount,
          'commission-void',
          c.id,
          db,
        );
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
        if (
          !(await this.influencerHasApprovedPost(
            c.beneficiaryId,
            c.order.promoCode,
          ))
        ) {
          continue; // not payout-eligible yet
        }
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.commissionRecord.update({
          where: { id: c.id },
          data: { status: CommissionStatus.CONFIRMED, confirmedAt: new Date() },
        });
        await this.ledger.credit(
          c.beneficiaryId,
          c.amount,
          'commission',
          c.id,
          tx,
        );
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
    const promo = await this.prisma.promoCode.findUnique({
      where: { code: promoCode },
    });
    if (!promo?.campaignId) return false;

    const influencer = await this.prisma.influencerProfile.findUnique({
      where: { userId: beneficiaryUserId },
    });
    if (!influencer) return false;

    const approved = await this.prisma.campaignSubmission.findFirst({
      where: {
        status: SubmissionStatus.APPROVED,
        hasAdDisclosure: true,
        assignment: {
          campaignId: promo.campaignId,
          influencerId: influencer.id,
        },
      },
    });
    return !!approved;
  }
}
