import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  BeneficiaryType,
  OrderStatus,
  Prisma,
  ProductStatus,
  ReviewStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Orders that are paid for but not yet despatched — the vendor's to-do list. */
const AWAITING_DESPATCH: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
];

/** Orders that never count toward sales (unpaid or unwound). */
const DEAD_ORDERS: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
];

const DAY = 86_400_000;

/** Short weekday name in Lagos time, e.g. "Mon". */
const weekdayLabel = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Africa/Lagos' });

/**
 * Period-over-period change as a percentage, rounded to 1 dp. No prior activity
 * reads as +100% when there's new activity, 0% when both are empty — so the card
 * never shows a misleading "Infinity%".
 */
function pctChange(
  current: Prisma.Decimal | number,
  previous: Prisma.Decimal | number,
): number {
  const cur = new Prisma.Decimal(current);
  const prev = new Prisma.Decimal(previous);
  if (prev.isZero()) return cur.isZero() ? 0 : 100;
  return Number(cur.minus(prev).dividedBy(prev).times(100).toFixed(1));
}

@Injectable()
export class VendorOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!vendor) throw new ForbiddenException('Not a vendor');

    const mine = { product: { vendorId: vendor.id } };

    // Time windows for the trend cards + chart (Lagos day boundaries would be
    // ideal, but UTC is close enough for a rolling-7-day view and keeps it simple).
    const now = new Date();
    const start7 = new Date(now.getTime() - 7 * DAY);
    const start14 = new Date(now.getTime() - 14 * DAY);
    const start30 = new Date(now.getTime() - 30 * DAY);
    // The vendor keeps everything except the platform take-rate.
    const keepRate = new Prisma.Decimal(10000 - vendor.takeRateBps).dividedBy(
      10000,
    );

    const [
      products,
      awaiting,
      soldItems,
      earnings,
      ratings,
      wallet,
      recentItems,
      items30,
    ] = await Promise.all([
        this.prisma.product.groupBy({
          by: ['status'],
          where: { vendorId: vendor.id },
          _count: { _all: true },
        }),
        this.prisma.order.count({
          where: { status: { in: AWAITING_DESPATCH }, items: { some: mine } },
        }),
        // Gross value of this vendor's lines across orders that actually stand.
        this.prisma.orderItem.aggregate({
          where: {
            product: { vendorId: vendor.id },
            order: { status: { notIn: DEAD_ORDERS } },
          },
          _sum: { totalPrice: true },
          _count: { _all: true },
        }),
        this.prisma.commissionRecord.groupBy({
          by: ['status'],
          where: {
            beneficiaryId: userId,
            beneficiaryType: BeneficiaryType.VENDOR,
          },
          _sum: { amount: true },
        }),
        this.prisma.review.aggregate({
          where: { vendorId: vendor.id, status: ReviewStatus.PUBLISHED },
          _avg: { rating: true },
          _count: { _all: true },
        }),
        this.prisma.wallet.findUnique({ where: { userId } }),
        // Last 14 days of this vendor's sold lines — powers the 7-day cards
        // (current vs prior week) and the daily revenue chart.
        this.prisma.orderItem.findMany({
          where: {
            product: { vendorId: vendor.id },
            order: { status: { notIn: DEAD_ORDERS }, createdAt: { gte: start14 } },
          },
          select: {
            baseUnitPrice: true,
            unitPrice: true,
            quantity: true,
            orderId: true,
            order: { select: { createdAt: true } },
          },
        }),
        // Last 30 days grouped later in JS for the Top sellers panel.
        this.prisma.orderItem.findMany({
          where: {
            product: { vendorId: vendor.id },
            order: { status: { notIn: DEAD_ORDERS }, createdAt: { gte: start30 } },
          },
          select: {
            quantity: true,
            productId: true,
            baseUnitPrice: true,
            unitPrice: true,
            product: {
              select: {
                title: true,
                price: true,
                images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
              },
            },
          },
        }),
      ]);

    const countOf = (s: ProductStatus) =>
      products.find((p) => p.status === s)?._count._all ?? 0;

    const earned = (statuses: string[]) =>
      earnings
        .filter((e) => statuses.includes(e.status))
        .reduce(
          (acc, e) => acc.plus(e._sum.amount ?? 0),
          new Prisma.Decimal(0),
        );

    // Vendor net for a line = base (pre-markup) × qty × keep-rate.
    const netOf = (i: (typeof recentItems)[number]) =>
      (i.baseUnitPrice ?? i.unitPrice).times(i.quantity).times(keepRate);

    // Daily revenue for the last 7 days, in chronological order (chart).
    const series = Array.from({ length: 7 }, (_, idx) => {
      const d = new Date(now.getTime() - (6 - idx) * DAY);
      return { key: d.toISOString().slice(0, 10), label: weekdayLabel(d), amount: new Prisma.Decimal(0) };
    });
    let revenue7 = new Prisma.Decimal(0);
    let revenuePrev7 = new Prisma.Decimal(0);
    const orders7 = new Set<string>();
    const ordersPrev7 = new Set<string>();
    for (const it of recentItems) {
      const created = it.order.createdAt;
      const net = netOf(it);
      if (created >= start7) {
        revenue7 = revenue7.plus(net);
        orders7.add(it.orderId);
        const key = created.toISOString().slice(0, 10);
        const bucket = series.find((s) => s.key === key);
        if (bucket) bucket.amount = bucket.amount.plus(net);
      } else {
        revenuePrev7 = revenuePrev7.plus(net);
        ordersPrev7.add(it.orderId);
      }
    }

    // Platform commission taken from this vendor over the last 30 days — the
    // take-rate applied to each line's base value. Powers the "Commission (30d)"
    // card on the payouts screen.
    const takeRate = new Prisma.Decimal(vendor.takeRateBps).dividedBy(10000);
    const commission30d = items30.reduce(
      (acc, i) =>
        acc.plus((i.baseUnitPrice ?? i.unitPrice).times(i.quantity).times(takeRate)),
      new Prisma.Decimal(0),
    );

    // Top sellers over 30 days: units sold per product, richest first.
    const sellers = new Map<
      string,
      { title: string; image: string | null; price: Prisma.Decimal; units: number }
    >();
    for (const it of items30) {
      const cur = sellers.get(it.productId) ?? {
        title: it.product.title,
        image: it.product.images[0]?.url ?? null,
        price: it.product.price,
        units: 0,
      };
      cur.units += it.quantity;
      sellers.set(it.productId, cur);
    }
    const topSellers = [...sellers.values()]
      .sort((a, b) => b.units - a.units)
      .slice(0, 5)
      .map((s) => ({ title: s.title, image: s.image, price: s.price, units: s.units }));

    return {
      businessName: vendor.businessName,
      isApproved: vendor.isApproved,
      /** Platform commission in basis points — 1000 = 10%. */
      takeRateBps: vendor.takeRateBps,
      products: {
        total: products.reduce((n, p) => n + p._count._all, 0),
        active: countOf(ProductStatus.ACTIVE),
        draft: countOf(ProductStatus.DRAFT),
        pendingReview: countOf(ProductStatus.PENDING_REVIEW),
        rejected: countOf(ProductStatus.REJECTED),
      },
      orders: { awaitingDespatch: awaiting },
      sales: {
        /** Gross value of this vendor's items, before the platform's cut. */
        gross: soldItems._sum.totalPrice ?? new Prisma.Decimal(0),
        unitsOrdered: soldItems._count._all,
      },
      earnings: {
        pending: earned(['PENDING', 'CONFIRMED', 'QUEUED']),
        disbursed: earned(['DISBURSED']),
      },
      rating: {
        average: ratings._avg.rating,
        count: ratings._count._all,
      },
      walletBalance: wallet?.balance ?? new Prisma.Decimal(0),
      // ── Dashboard analytics (rolling windows, real orders) ──
      /** Net revenue after fees over the last 7 days + % change vs the prior 7. */
      revenue7: { amount: revenue7, deltaPct: pctChange(revenue7, revenuePrev7) },
      /** Orders in the last 7 days + % change vs the prior 7. */
      orders7: { count: orders7.size, deltaPct: pctChange(orders7.size, ordersPrev7.size) },
      /** Confirmed-but-undisbursed earnings — the next payout. */
      pendingPayout: earned(['PENDING', 'CONFIRMED', 'QUEUED']),
      /** Net revenue per day for the last 7 days (chart), oldest → newest. */
      weeklyRevenue: series.map((s) => ({ label: s.label, amount: s.amount })),
      /** Best-selling products by units over the last 30 days. */
      topSellers,
      /** Platform commission taken from this vendor over the last 30 days. */
      commission30d,
    };
  }

  /** Reviews left on this vendor's products, newest first. */
  async reviews(userId: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!vendor) throw new ForbiddenException('Not a vendor');

    const rows = await this.prisma.review.findMany({
      where: { vendorId: vendor.id, status: { not: ReviewStatus.REMOVED } },
      include: {
        product: {
          select: {
            title: true,
            slug: true,
            images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
          },
        },
        author: { select: { firstName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      status: r.status,
      authorName: r.author.firstName,
      product: r.product
        ? { title: r.product.title, slug: r.product.slug, image: r.product.images[0]?.url ?? null }
        : null,
      responseBody: r.responseBody,
      responseAt: r.responseAt,
      createdAt: r.createdAt,
    }));
  }
}
