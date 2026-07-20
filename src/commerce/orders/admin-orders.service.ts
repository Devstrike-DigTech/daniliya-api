import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { CommissionsService } from '../../commissions/commissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdvanceOrderDto } from './dto/orders.dto';

/** Forward order along the fulfilment ladder; higher rank is further along. */
const FULFILMENT_RANK: Record<OrderStatus, number> = {
  PENDING: 0,
  CONFIRMED: 1,
  PROCESSING: 2,
  SHIPPED: 3,
  DELIVERED: 4,
  COMPLETED: 5,
  CANCELLED: -1,
  REFUNDED: -1,
};

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commissions: CommissionsService,
    private readonly audit: AuditService,
  ) {}

  async list(status?: OrderStatus) {
    const orders = await this.prisma.order.findMany({
      where: status ? { status } : undefined,
      include: {
        payment: true,
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return orders.map((o) => ({
      ref: o.ref,
      status: o.status,
      channel: o.channel,
      customer: `${o.customer.firstName} ${o.customer.lastName}`,
      total: o.total,
      payment: o.payment
        ? { method: o.payment.method, status: o.payment.status }
        : null,
      createdAt: o.createdAt,
    }));
  }

  /** Full order detail for the admin order page. */
  async byRef(ref: string) {
    const o = await this.prisma.order.findUnique({
      where: { ref },
      include: {
        payment: true,
        customer: {
          select: { firstName: true, lastName: true, email: true, phone: true },
        },
        items: {
          include: {
            product: {
              select: { id: true, vendor: { select: { businessName: true } } },
            },
          },
        },
      },
    });
    if (!o) throw new NotFoundException('Order not found');

    return {
      ref: o.ref,
      status: o.status,
      channel: o.channel,
      fulfilmentMode: o.fulfilmentMode,
      customer: {
        name: `${o.customer.firstName} ${o.customer.lastName}`,
        email: o.customer.email,
        phone: o.customer.phone,
      },
      subtotal: o.subtotal,
      giftAddon: o.giftAddon,
      deliveryFee: o.deliveryFee,
      tax: o.tax,
      total: o.total,
      deliveryAddress: o.deliveryAddress,
      contact: o.contact,
      notes: o.notes,
      affiliateCode: o.affiliateCode,
      influencerCode: o.influencerCode,
      promoCode: o.promoCode,
      payment: o.payment
        ? {
            method: o.payment.method,
            status: o.payment.status,
            providerRef: o.payment.providerRef,
            paidAt: o.payment.paidAt,
          }
        : null,
      items: o.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        titleSnapshot: it.titleSnapshot,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        giftWrap: it.giftWrap,
        vendor: it.product.vendor?.businessName ?? null,
      })),
      confirmedAt: o.confirmedAt,
      shippedAt: o.shippedAt,
      deliveredAt: o.deliveredAt,
      cancelledAt: o.cancelledAt,
      createdAt: o.createdAt,
    };
  }

  /**
   * Move an order forward through fulfilment: CONFIRMED → PROCESSING → SHIPPED →
   * DELIVERED → COMPLETED. Admins fulfil Daniliya-owned orders (no vendor to
   * ship them) and can push any order along; a vendor's own `ship` uses the
   * same shipment record.
   *
   * Only ever forward, never from an unpaid or reversed order. Moving to SHIPPED
   * needs a courier and writes the Shipment the buyer tracks.
   */
  async advance(
    ref: string,
    dto: AdvanceOrderDto,
    adminId: string,
    ip?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { ref },
      include: { shipment: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === OrderStatus.PENDING) {
      throw new BadRequestException('This order has not been paid for yet');
    }
    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.REFUNDED
    ) {
      throw new BadRequestException(
        `A ${order.status.toLowerCase()} order cannot be updated`,
      );
    }

    const target = dto.status as OrderStatus;
    if (FULFILMENT_RANK[target] <= FULFILMENT_RANK[order.status]) {
      throw new BadRequestException(
        `Cannot move a ${order.status.toLowerCase()} order to ${target.toLowerCase()} — fulfilment only moves forward`,
      );
    }
    if (target === OrderStatus.SHIPPED && !dto.courier?.trim()) {
      throw new BadRequestException(
        'A courier is required to mark an order shipped',
      );
    }

    const estimatedDelivery = dto.estimatedDelivery
      ? new Date(dto.estimatedDelivery)
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      // Crossing into SHIPPED (now or already past it, if details are being
      // corrected) creates/updates the shipment the buyer sees.
      if (target === OrderStatus.SHIPPED) {
        await tx.shipment.upsert({
          where: { orderId: order.id },
          create: {
            orderId: order.id,
            courier: dto.courier!.trim(),
            trackingNumber: dto.trackingNumber?.trim() || null,
            estimatedDelivery: estimatedDelivery ?? null,
          },
          update: {
            courier: dto.courier!.trim(),
            trackingNumber: dto.trackingNumber?.trim() || null,
            ...(estimatedDelivery ? { estimatedDelivery } : {}),
          },
        });
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: target,
          // Keep the first timestamp for each milestone across later edits.
          ...(target === OrderStatus.SHIPPED
            ? { shippedAt: order.shippedAt ?? new Date() }
            : {}),
          ...(target === OrderStatus.DELIVERED
            ? { deliveredAt: order.deliveredAt ?? new Date() }
            : {}),
        },
      });
    });

    await this.audit.record({
      actorId: adminId,
      action: `Order → ${target.toLowerCase()}`,
      targetType: 'Order',
      targetId: order.id,
      before: { status: order.status },
      after: { status: target },
      ip,
    });

    return { ref: order.ref, status: target };
  }

  refund(ref: string, adminId: string, ip?: string) {
    return this.reverse(ref, OrderStatus.REFUNDED, adminId, ip);
  }

  cancel(ref: string, adminId: string, ip?: string) {
    return this.reverse(ref, OrderStatus.CANCELLED, adminId, ip);
  }

  /** Refund/cancel: restore stock, mark payment refunded, void commissions. */
  private async reverse(
    ref: string,
    to: OrderStatus,
    adminId: string,
    ip?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { ref },
      include: { items: true, payment: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (
      order.status === OrderStatus.REFUNDED ||
      order.status === OrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Order is already ${order.status.toLowerCase()}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: to, cancelledAt: new Date() },
      });

      if (order.payment && order.payment.status !== PaymentStatus.REFUNDED) {
        await tx.payment.update({
          where: { id: order.payment.id },
          data: { status: PaymentStatus.REFUNDED, refundedAt: new Date() },
        });
      }

      // Return reserved stock.
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQuantity: { increment: item.quantity } },
        });
      }

      // Reverse any commissions not yet paid out.
      await this.commissions.voidForOrder(order.id, tx);
    });

    await this.audit.record({
      actorId: adminId,
      action:
        to === OrderStatus.REFUNDED ? 'Refunded order' : 'Cancelled order',
      targetType: 'Order',
      targetId: order.id,
      before: { status: order.status },
      after: { status: to },
      ip,
    });

    return { ref: order.ref, status: to };
  }
}
