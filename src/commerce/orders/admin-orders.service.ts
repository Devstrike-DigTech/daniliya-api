import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { CommissionsService } from '../../commissions/commissions.service';
import { PrismaService } from '../../prisma/prisma.service';

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
