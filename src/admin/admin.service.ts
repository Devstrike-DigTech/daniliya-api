import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CommissionStatus,
  OrderStatus,
  PayoutItemStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RejectProductDto } from './dto/admin.dto';

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

  // ── Command centre ────────────────────────────────────────────────────

  async overview() {
    const paidStatuses = [
      OrderStatus.CONFIRMED,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ];
    const [gmv, orders, users, pendingPayout, attribution] = await Promise.all([
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
    ]);
    return {
      gmv: gmv._sum.total ?? new Prisma.Decimal(0),
      orders,
      users,
      pendingPayouts: pendingPayout._sum.amount ?? new Prisma.Decimal(0),
      attribution: attribution.map((a) => ({
        channel: a.channel,
        orders: a._count,
      })),
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
