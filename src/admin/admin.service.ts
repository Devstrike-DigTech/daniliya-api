import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommissionStatus,
  OrderStatus,
  PayoutItemStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminCreateProductDto,
  AdminUpdateProductDto,
  RejectProductDto,
} from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Products moderation ───────────────────────────────────────────────

  products(status?: ProductStatus, q?: string) {
    return this.prisma.product.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      },
      include: { vendor: { select: { businessName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async product(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, businessName: true } },
        images: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { orderItems: true, reviews: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async approveProduct(id: string, adminId: string, ip?: string) {
    return this.moderateProduct(
      id,
      ProductStatus.ACTIVE,
      undefined,
      adminId,
      ip,
    );
  }
  async rejectProduct(
    id: string,
    dto: RejectProductDto,
    adminId: string,
    ip?: string,
  ) {
    return this.moderateProduct(
      id,
      ProductStatus.REJECTED,
      dto.reason,
      adminId,
      ip,
    );
  }

  private async moderateProduct(
    id: string,
    to: ProductStatus,
    reason: string | undefined,
    adminId: string,
    ip?: string,
  ) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        status: to,
        rejectedReason:
          to === ProductStatus.REJECTED ? (reason ?? 'Rejected') : null,
      },
    });
    await this.audit.record({
      actorId: adminId,
      action:
        to === ProductStatus.ACTIVE ? 'Approved product' : 'Rejected product',
      targetType: 'Product',
      targetId: id,
      before: { status: product.status },
      after: { status: to },
      ip,
    });
    return updated;
  }

  // ── Product authoring (admin) ─────────────────────────────────────────

  /** Approved vendors for the "attribute to vendor" picker. */
  vendorsForSelect() {
    return this.prisma.vendorProfile.findMany({
      where: { isApproved: true },
      select: { id: true, businessName: true },
      orderBy: { businessName: 'asc' },
    });
  }

  /**
   * Create a product as the platform (vendorId null) or on a vendor's behalf.
   * Admins have authority to publish straight to ACTIVE, unlike vendors whose
   * products go through review.
   */
  async createProduct(dto: AdminCreateProductDto, adminId: string, ip?: string) {
    const vendorId = dto.vendorId || null;
    if (vendorId) await this.vendorOrThrow(vendorId);

    const status = dto.publish === false ? ProductStatus.DRAFT : ProductStatus.ACTIVE;
    const product = await this.prisma.product.create({
      data: {
        vendorId,
        title: dto.title,
        slug: await this.uniqueSlug(dto.title),
        description: dto.description,
        price: new Prisma.Decimal(dto.price),
        commissionRate: new Prisma.Decimal(dto.commissionRate ?? 0),
        stockQuantity: dto.stockQuantity,
        category: dto.category,
        status,
        images: dto.imageUrls?.length
          ? { create: dto.imageUrls.map((url, sortOrder) => ({ url, sortOrder })) }
          : undefined,
      },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });

    await this.audit.record({
      actorId: adminId,
      action: 'Created product',
      targetType: 'Product',
      targetId: product.id,
      after: { title: product.title, status, vendorId },
      ip,
    });
    return product;
  }

  /** Edit any product's fields, vendor attribution and images. */
  async updateProduct(
    id: string,
    dto: AdminUpdateProductDto,
    adminId: string,
    ip?: string,
  ) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');

    // vendorId: undefined = leave as-is; null/'' = platform; uuid = that vendor.
    let vendorUpdate: string | null | undefined;
    if (dto.vendorId !== undefined) {
      const vendorId = dto.vendorId || null;
      if (vendorId) await this.vendorOrThrow(vendorId);
      vendorUpdate = vendorId;
    }

    const data: Prisma.ProductUncheckedUpdateInput = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
      ...(dto.commissionRate !== undefined
        ? { commissionRate: new Prisma.Decimal(dto.commissionRate) }
        : {}),
      ...(dto.stockQuantity !== undefined
        ? { stockQuantity: dto.stockQuantity }
        : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(vendorUpdate !== undefined ? { vendorId: vendorUpdate } : {}),
    };

    const updated = await this.prisma.product.update({ where: { id }, data });

    // Images are replaced wholesale when the field is present — the form always
    // sends the full set it wants kept.
    if (dto.imageUrls !== undefined) {
      await this.prisma.$transaction([
        this.prisma.productImage.deleteMany({ where: { productId: id } }),
        ...(dto.imageUrls.length
          ? [
              this.prisma.productImage.createMany({
                data: dto.imageUrls.map((url, sortOrder) => ({
                  productId: id,
                  url,
                  sortOrder,
                })),
              }),
            ]
          : []),
      ]);
    }

    await this.audit.record({
      actorId: adminId,
      action: 'Edited product',
      targetType: 'Product',
      targetId: id,
      before: { title: existing.title, price: existing.price.toString() },
      after: { title: updated.title, price: updated.price.toString() },
      ip,
    });

    return this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: {
        vendor: { select: { id: true, businessName: true } },
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  /** Take a live product off the storefront (reversible). */
  delistProduct(id: string, adminId: string, ip?: string) {
    return this.setListing(id, ProductStatus.REMOVED, 'Delisted product', adminId, ip);
  }

  /** Put a delisted (or draft) product back on the storefront. */
  relistProduct(id: string, adminId: string, ip?: string) {
    return this.setListing(id, ProductStatus.ACTIVE, 'Relisted product', adminId, ip);
  }

  private async setListing(
    id: string,
    to: ProductStatus,
    action: string,
    adminId: string,
    ip?: string,
  ) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.status === to) {
      throw new BadRequestException(
        `Product is already ${to.toLowerCase()}`,
      );
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: to },
    });
    await this.audit.record({
      actorId: adminId,
      action,
      targetType: 'Product',
      targetId: id,
      before: { status: product.status },
      after: { status: to },
      ip,
    });
    return updated;
  }

  private async vendorOrThrow(vendorId: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorId },
      select: { id: true },
    });
    if (!vendor) throw new BadRequestException('That vendor does not exist');
    return vendor;
  }

  private async uniqueSlug(title: string): Promise<string> {
    const base =
      title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'product';
    for (let i = 0; i < 10; i++) {
      const slug = i === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      if (!(await this.prisma.product.findUnique({ where: { slug } })))
        return slug;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }

  // ── Command centre ────────────────────────────────────────────────────

  async overview() {
    const paidStatuses = [
      OrderStatus.CONFIRMED,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ];
    // Midnight 6 days ago → a 7-day window including today.
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);

    const [
      gmv,
      orders,
      users,
      pendingPayout,
      attribution,
      weekOrders,
      pendingProducts,
      payoutsInReview,
      openTickets,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: { status: { in: paidStatuses } },
        _sum: { total: true },
      }),
      this.prisma.order.count(),
      this.prisma.user.count(),
      this.prisma.payoutItem.aggregate({
        where: { status: PayoutItemStatus.PENDING },
        _sum: { amount: true },
      }),
      this.prisma.order.groupBy({
        by: ['channel'],
        _count: true,
        where: { status: { in: paidStatuses } },
      }),
      // Paid orders in the last 7 days, bucketed into a daily series below.
      this.prisma.order.findMany({
        where: {
          status: { in: paidStatuses },
          confirmedAt: { gte: weekStart },
        },
        select: { total: true, confirmedAt: true },
      }),
      this.prisma.product.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.payoutBatch.count({ where: { status: 'REVIEW' } }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
    ]);

    // One bucket per day, oldest → newest, labelled by weekday.
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const series = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return { day: days[d.getDay()], date: d, value: new Prisma.Decimal(0) };
    });
    for (const o of weekOrders) {
      const when = o.confirmedAt ?? weekStart;
      const idx = Math.floor(
        (new Date(when).setHours(0, 0, 0, 0) - weekStart.getTime()) /
          86_400_000,
      );
      if (idx >= 0 && idx < 7) {
        series[idx].value = series[idx].value.plus(o.total);
      }
    }
    const weekRevenue = series.reduce(
      (sum, s) => sum.plus(s.value),
      new Prisma.Decimal(0),
    );

    return {
      gmv: gmv._sum.total ?? new Prisma.Decimal(0),
      orders,
      users,
      pendingPayouts: pendingPayout._sum.amount ?? new Prisma.Decimal(0),
      attribution: attribution.map((a) => ({
        channel: a.channel,
        orders: a._count,
      })),
      weekRevenue,
      revenueSeries: series.map((s) => ({ day: s.day, value: s.value })),
      attention: {
        pendingProducts,
        payoutsInReview,
        openTickets,
      },
    };
  }

  // ── Finance ───────────────────────────────────────────────────────────

  async financeStats() {
    const [commissionsPaid, commissionsPending, disbursed] = await Promise.all([
      this.prisma.commissionRecord.aggregate({
        where: { status: CommissionStatus.DISBURSED },
        _sum: { amount: true },
      }),
      this.prisma.commissionRecord.aggregate({
        where: {
          status: { in: [CommissionStatus.CONFIRMED, CommissionStatus.QUEUED] },
        },
        _sum: { amount: true },
      }),
      this.prisma.payoutBatch.aggregate({
        where: { status: 'PAID' },
        _sum: { totalAmount: true },
      }),
    ]);
    return {
      totalPaidOut: disbursed._sum.totalAmount ?? new Prisma.Decimal(0),
      commissionsDisbursed:
        commissionsPaid._sum.amount ?? new Prisma.Decimal(0),
      commissionsOwed: commissionsPending._sum.amount ?? new Prisma.Decimal(0),
    };
  }

  // ── Audit log ─────────────────────────────────────────────────────────

  async auditLog(query: {
    actor?: string;
    action?: string;
    target?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actor ? { actorId: query.actor } : {}),
      ...(query.action
        ? { action: { contains: query.action, mode: 'insensitive' } }
        : {}),
      ...(query.target ? { targetType: query.target } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({
        actor: r.actor ? `${r.actor.firstName} ${r.actor.lastName}` : 'System',
        action: r.action,
        target: r.targetType,
        at: r.createdAt,
      })),
      meta: { page, limit, total },
    };
  }
}
