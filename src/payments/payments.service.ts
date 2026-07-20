import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { CommissionsService } from '../commissions/commissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from './paystack.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly commissions: CommissionsService,
  ) {}

  /**
   * Process a Paystack webhook. Idempotent (WebhookEvent + providerRef guards)
   * and signature-verified — Paystack retries, so this must be replay-safe.
   */
  async handlePaystackWebhook(rawBody: Buffer, signature?: string) {
    if (!this.paystack.verifySignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      data: { reference?: string; id?: number | string };
    };

    const reference = event.data?.reference;
    const externalEventId = `paystack:${event.event}:${reference ?? event.data?.id}`;

    // Dedupe replays.
    const seen = await this.prisma.webhookEvent.findUnique({
      where: { externalEventId },
    });
    if (seen) {
      return { received: true, duplicate: true };
    }

    if (event.event === 'charge.success' && reference) {
      await this.markPaid(reference);
    } else if (event.event === 'charge.failed' && reference) {
      await this.markFailed(reference);
    }

    await this.prisma.webhookEvent.create({
      data: {
        provider: 'paystack',
        externalEventId,
        eventType: event.event,
        payload: event,
      },
    });

    return { received: true, duplicate: false };
  }

  /**
   * Confirm an order by asking Paystack about its transaction, rather than
   * waiting for the webhook. Called when the buyer returns from checkout.
   *
   * Safe to call repeatedly and safe on an unknown/other reference: it only
   * confirms on a genuine Paystack "success", and markPaid is idempotent. It
   * never marks anything failed — a card the buyer abandoned just stays PENDING.
   */
  async verifyAndConfirm(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerRef: reference },
      include: { order: { select: { ref: true, status: true } } },
    });
    if (!payment) {
      return { ref: null, status: 'unknown' as const, paid: false };
    }
    // Already settled by the webhook (or a previous verify) — don't call out again.
    if (payment.status === PaymentStatus.PAID) {
      return {
        ref: payment.order.ref,
        status: payment.order.status,
        paid: true,
      };
    }

    const result = await this.paystack.verifyTransaction(reference);
    if (result.paid) {
      await this.markPaid(reference);
      return {
        ref: payment.order.ref,
        status: OrderStatus.CONFIRMED,
        paid: true,
      };
    }

    return {
      ref: payment.order.ref,
      status: payment.order.status,
      paid: false,
      gateway: result.status,
    };
  }

  private async markPaid(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerRef: reference },
      include: { order: true },
    });
    if (!payment) {
      this.logger.warn(`charge.success for unknown reference ${reference}`);
      return;
    }
    if (payment.status === PaymentStatus.PAID) return; // idempotent

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.PAID, paidAt: new Date() },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: OrderStatus.CONFIRMED, confirmedAt: new Date() },
      });
      // Clear the buyer's cart now the order is paid.
      const cart = await tx.cart.findUnique({
        where: { userId: payment.order.customerId },
      });
      if (cart) await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    });

    // Attribute commissions once the order is confirmed (idempotent).
    await this.commissions.accrueForOrder(payment.orderId);
    this.logger.log(`Order ${payment.orderId} confirmed via ${reference}`);
  }

  private async markFailed(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerRef: reference },
    });
    if (!payment || payment.status === PaymentStatus.PAID) return;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED, failedAt: new Date() },
    });
  }
}
