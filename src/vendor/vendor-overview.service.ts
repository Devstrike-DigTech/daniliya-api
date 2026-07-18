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

@Injectable()
export class VendorOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!vendor) throw new ForbiddenException('Not a vendor');

    const mine = { product: { vendorId: vendor.id } };

    const [products, awaiting, soldItems, earnings, ratings, wallet] =
      await Promise.all([
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
            order: {
              status: {
                notIn: [
                  OrderStatus.PENDING,
                  OrderStatus.CANCELLED,
                  OrderStatus.REFUNDED,
                ],
              },
            },
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
        product: { select: { title: true, slug: true } },
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
        ? { title: r.product.title, slug: r.product.slug }
        : null,
      responseBody: r.responseBody,
      responseAt: r.responseAt,
      createdAt: r.createdAt,
    }));
  }
}
