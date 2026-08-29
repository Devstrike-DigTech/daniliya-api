import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BeneficiaryType,
  CommissionStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PRICING } from '../config/pricing';
import { shareLink } from '../common/share-links';

const DAY = 86_400_000;
const weekdayLabel = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Africa/Lagos' });
function pctChange(cur: Prisma.Decimal | number, prev: Prisma.Decimal | number): number {
  const c = new Prisma.Decimal(cur);
  const p = new Prisma.Decimal(prev);
  if (p.isZero()) return c.isZero() ? 0 : 100;
  return Number(c.minus(p).dividedBy(p).times(100).toFixed(1));
}

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
    const now = new Date();
    const start7 = new Date(now.getTime() - 7 * DAY);
    const start14 = new Date(now.getTime() - 14 * DAY);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    const [records, clicks14, totalClicks] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where: {
          beneficiaryId: userId,
          beneficiaryType: BeneficiaryType.AFFILIATE,
          status: { not: CommissionStatus.VOIDED },
        },
        select: { amount: true, status: true, createdAt: true },
      }),
      p.referralCode
        ? this.prisma.clickEvent.findMany({
            where: { affiliateCode: p.referralCode, timestamp: { gte: start14 } },
            select: { timestamp: true },
          })
        : Promise.resolve([] as { timestamp: Date }[]),
      p.referralCode
        ? this.prisma.clickEvent.count({ where: { affiliateCode: p.referralCode } })
        : Promise.resolve(0),
    ]);

    const zero = new Prisma.Decimal(0);
    const sumWhere = (fn: (r: (typeof records)[number]) => boolean) =>
      records.filter(fn).reduce((a, r) => a.plus(r.amount), zero);

    const earned: CommissionStatus[] = EARNED_STATES;
    const unpaid: CommissionStatus[] = UNPAID_STATES;
    const lifetime = sumWhere((r) => earned.includes(r.status));
    const pending = sumWhere((r) => unpaid.includes(r.status));
    const conversions = records.length;
    const thisMonth = sumWhere((r) => r.createdAt >= monthStart);
    const prevMonth = sumWhere((r) => r.createdAt >= prevMonthStart && r.createdAt < monthStart);

    // Weekly earnings series (last 7 days, chronological).
    const series = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getTime() - (6 - i) * DAY);
      return { key: d.toISOString().slice(0, 10), label: weekdayLabel(d), amount: zero };
    });
    for (const r of records) {
      if (r.createdAt >= start7) {
        const b = series.find((s) => s.key === r.createdAt.toISOString().slice(0, 10));
        if (b) b.amount = b.amount.plus(r.amount);
      }
    }

    const clicksThisWeek = clicks14.filter((c) => c.timestamp >= start7).length;
    const clicksPrev = clicks14.length - clicksThisWeek;
    const conversionRate = totalClicks > 0 ? Number(((conversions / totalClicks) * 100).toFixed(1)) : 0;

    return {
      code: p.referralCode,
      tier: p.tier,
      isActive: p.isActive,
      lifetimeEarnings: lifetime,
      pending,
      conversions,
      /** Flat commission the affiliate earns per confirmed sale. */
      commissionPerSale: PRICING.AFFILIATE_COMMISSION,
      earningsMomPct: pctChange(thisMonth, prevMonth),
      clicksThisWeek,
      clicksDeltaPct: pctChange(clicksThisWeek, clicksPrev),
      conversionRate,
      weekly: series.map((s) => ({ label: s.label, amount: s.amount })),
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
    const code = p.referralCode;
    return {
      master: shareLink(code, 'affiliate'),
      products: products.map((pr) => ({
        title: pr.title,
        price: pr.price,
        link: shareLink(code, 'affiliate', pr.slug),
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
