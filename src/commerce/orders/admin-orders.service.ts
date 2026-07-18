import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
      payment: o.payment ? { method: o.payment.method, status: o.payment.status } : null,
      createdAt: o.createdAt,
    }));
  }

  refund(ref: string, adminId: string, ip?: string) {
    return this.reverse(ref, OrderStatus.REFUNDED, adminId, ip);
  }

  cancel(ref: string, adminId: string, ip?: string) {
    return this.reverse(ref, OrderStatus.CANCELLED, adminId, ip);
  }

  /** Refund/cancel: restore stock, mark payment refunded, void commissions. */
  private async reverse(ref: string, to: OrderStatus, adminId: string, ip?: string) {
    const order = await this.prisma.order.findUnique({
      where: { ref },
      include: { items: true, payment: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.REFUNDED || order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException(`Order is already ${order.status.toLowerCase()}`);
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
      action: to === OrderStatus.REFUNDED ? 'Refunded order' : 'Cancelled order',
      targetType: 'Order',
      targetId: order.id,
      before: { status: order.status },
      after: { status: to },
      ip,
    });

    return { ref: order.ref, status: to };
  }
}
