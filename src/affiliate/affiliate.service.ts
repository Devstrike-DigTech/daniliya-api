import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BeneficiaryType,
  CommissionStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Everything not refunded — used for lifetime/leaderboard totals. */
const EARNED_STATES = [
  CommissionStatus.PENDING,
  CommissionStatus.CONFIRMED,
  CommissionStatus.QUEUED,
  CommissionStatus.DISBURSED,
];
/** Owed but not yet paid out. */
const UNPAID_STATES = [
  CommissionStatus.PENDING,
  CommissionStatus.CONFIRMED,
  CommissionStatus.QUEUED,
];

@Injectable()
export class AffiliateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Storefront origin the referral links point at, per environment. */
  private webBase(): string {
    return (
      this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
  }

  async overview(userId: string) {
    const p = await this.profileOrThrow(userId);
    const [lifetime, pending, conversions] = await Promise.all([
      this.sum(userId, EARNED_STATES),
      this.sum(userId, UNPAID_STATES),
      this.prisma.commissionRecord.count({
        where: {
          beneficiaryId: userId,
          beneficiaryType: BeneficiaryType.AFFILIATE,
          status: { not: CommissionStatus.VOIDED },
        },
      }),
    ]);
    return {
      code: p.referralCode,
      tier: p.tier,
      lifetimeEarnings: lifetime,
      pending,
      conversions,
      isActive: p.isActive,
    };
  }

  async links(userId: string) {
    const p = await this.profileOrThrow(userId);
    if (!p.referralCode) return { master: null, products: [] };
    const products = await this.prisma.product.findMany({
      where: { status: 'ACTIVE' },
      select: { slug: true, title: true, price: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const base = this.webBase();
    return {
      master: `${base}/shop?ref=${p.referralCode}`,
      products: products.map((pr) => ({
        title: pr.title,
        price: pr.price,
        link: `${base}/shop/${pr.slug}?ref=${p.referralCode}`,
      })),
    };
  }

  async earnings(userId: string) {
    await this.profileOrThrow(userId);
    const rows = await this.prisma.commissionRecord.findMany({
      where: {
        beneficiaryId: userId,
        beneficiaryType: BeneficiaryType.AFFILIATE,
      },
      include: {
        order: { select: { ref: true, total: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const commission = rows
      .filter((r) => r.status !== CommissionStatus.VOIDED)
      .reduce((s, r) => s.plus(r.amount), new Prisma.Decimal(0));
    const gmv = rows
      .filter((r) => r.status !== CommissionStatus.VOIDED)
      .reduce((s, r) => s.plus(r.order.total), new Prisma.Decimal(0));
    return {
      summary: {
        grossGmv: gmv,
        commissionEarned: commission,
        transactions: rows.length,
      },
      records: rows.map((r) => ({
        order: r.order.ref,
        sale: r.order.total,
        commission: r.amount,
        status: r.status,
        date: r.createdAt,
      })),
    };
  }

  async referrals(userId: string) {
    const p = await this.profileOrThrow(userId);
    if (!p.referralCode) return { summary: { customers: 0 }, rows: [] };

    const orders = await this.prisma.order.findMany({
      where: {
        affiliateCode: p.referralCode,
        status: { not: OrderStatus.CANCELLED },
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Group by customer.
    const byCustomer = new Map<
      string,
      { name: string; orders: number; spend: Prisma.Decimal; last: Date }
    >();
    for (const o of orders) {
      const key = o.customer.id;
      const g = byCustomer.get(key) ?? {
        name: `${o.customer.firstName} ${o.customer.lastName}`,
        orders: 0,
        spend: new Prisma.Decimal(0),
        last: o.createdAt,
      };
      g.orders += 1;
      g.spend = g.spend.plus(o.total);
      if (o.createdAt > g.last) g.last = o.createdAt;
      byCustomer.set(key, g);
    }
    return {
      summary: { customers: byCustomer.size, totalOrders: orders.length },
      rows: [...byCustomer.values()],
    };
  }

  async leaderboard(userId: string) {
    // Lifetime confirmed+ earnings per affiliate.
    const grouped = await this.prisma.commissionRecord.groupBy({
      by: ['beneficiaryId'],
      where: {
        beneficiaryType: BeneficiaryType.AFFILIATE,
        status: { in: EARNED_STATES },
      },
      _sum: { amount: true },
    });
    const ranked = grouped
      .map((g) => ({
        userId: g.beneficiaryId,
        earned: g._sum.amount ?? new Prisma.Decimal(0),
      }))
      .sort((a, b) => (b.earned.greaterThan(a.earned) ? 1 : -1));

    const profiles = await this.prisma.affiliateProfile.findMany({
      where: { userId: { in: ranked.map((r) => r.userId) } },
      include: { user: { select: { firstName: true } } },
    });
    const byUser = new Map(profiles.map((p) => [p.userId, p]));

    const top = ranked.slice(0, 10).map((r, i) => ({
      rank: i + 1,
      name: byUser.get(r.userId)?.user.firstName ?? 'Affiliate',
      code: byUser.get(r.userId)?.referralCode ?? null,
      earned: r.earned,
      you: r.userId === userId,
    }));
    const myRank = ranked.findIndex((r) => r.userId === userId);
    return { top, myRank: myRank >= 0 ? myRank + 1 : null };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async profileOrThrow(userId: string) {
    const p = await this.prisma.affiliateProfile.findUnique({
      where: { userId },
    });
    if (!p) throw new ForbiddenException('Not an affiliate');
    return p;
  }

  private async sum(userId: string, statuses: CommissionStatus[]) {
    const agg = await this.prisma.commissionRecord.aggregate({
      where: {
        beneficiaryId: userId,
        beneficiaryType: BeneficiaryType.AFFILIATE,
        status: { in: statuses },
      },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? new Prisma.Decimal(0);
  }
}
