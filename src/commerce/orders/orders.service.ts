import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FulfilmentMode,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { CommissionsService } from '../../commissions/commissions.service';
import { PaystackService } from '../../payments/paystack.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing.service';
import { PlaceOrderDto, QuoteDto } from './dto/orders.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly paystack: PaystackService,
    private readonly commissions: CommissionsService,
  ) {}

  /** Server-side total for the current cart under a fulfilment mode. */
  async quote(userId: string, dto: QuoteDto) {
    const items = await this.loadCartItems(userId);
    if (items.length === 0) throw new BadRequestException('Your cart is empty');

    const breakdown = this.pricing.quote(
      items.map((i) => ({ unitPrice: i.product.price, quantity: i.quantity, giftWrap: i.giftWrap })),
      dto.mode,
    );
    return { mode: dto.mode, ...breakdown };
  }

  async place(userId: string, dto: PlaceOrderDto) {
    if (dto.mode === FulfilmentMode.DELIVERY && !dto.deliveryAddress) {
      throw new BadRequestException('A delivery address is required for delivery orders');
    }

    const items = await this.loadCartItems(userId);
    if (items.length === 0) throw new BadRequestException('Your cart is empty');

    for (const it of items) {
      if (it.product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException(`"${it.product.title}" is no longer available`);
      }
      if (it.product.stockQuantity < it.quantity) {
        throw new BadRequestException(`Not enough stock for "${it.product.title}"`);
      }
    }

    const breakdown = this.pricing.quote(
      items.map((i) => ({ unitPrice: i.product.price, quantity: i.quantity, giftWrap: i.giftWrap })),
      dto.mode,
    );

    const channel = this.channelFor(dto);
    const isPod = dto.paymentMethod === PaymentMethod.PAY_ON_DELIVERY;

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          ref: this.newRef(),
          customerId: userId,
          // POD is confirmed on placement; card orders wait for the webhook.
          status: isPod ? OrderStatus.CONFIRMED : OrderStatus.PENDING,
          channel,
          fulfilmentMode: dto.mode,
          subtotal: breakdown.subtotal,
          giftAddon: breakdown.giftAddon,
          deliveryFee: breakdown.deliveryFee,
          tax: breakdown.tax,
          total: breakdown.total,
          affiliateCode: dto.affiliateCode,
          influencerCode: dto.influencerCode,
          promoCode: dto.promoCode,
          deliveryAddress: (dto.deliveryAddress ?? null) as Prisma.InputJsonValue,
          contact: dto.contact as unknown as Prisma.InputJsonValue,
          confirmedAt: isPod ? new Date() : null,
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              titleSnapshot: i.product.title,
              quantity: i.quantity,
              unitPrice: i.product.price,
              giftWrap: i.giftWrap,
              giftMeta: (i.giftMeta ?? undefined) as Prisma.InputJsonValue | undefined,
              totalPrice: i.product.price.times(i.quantity),
            })),
          },
          payment: {
            create: {
              method: dto.paymentMethod,
              status: PaymentStatus.PENDING,
              amount: breakdown.total,
              providerRef: isPod ? null : this.paystack.newReference(),
            },
          },
        },
        include: { payment: true },
      });

      // Reserve stock immediately so two buyers can't claim the last unit.
      for (const it of items) {
        await tx.product.update({
          where: { id: it.productId },
          data: { stockQuantity: { decrement: it.quantity } },
        });
      }

      // POD: order is confirmed now, so the cart can be cleared. Card orders keep
      // the cart until the webhook confirms payment.
      if (isPod) {
        await tx.cartItem.deleteMany({ where: { cart: { userId } } });
      }

      return created;
    });

    if (isPod) {
      // POD is confirmed on placement, so attribute commissions now.
      await this.commissions.accrueForOrder(order.id);
      return {
        order: this.orderSummary(order),
        payment: { method: order.payment!.method, status: order.payment!.status },
        message: 'Order placed — pay on delivery.',
      };
    }

    const init = await this.paystack.initializeTransaction({
      email: dto.contact.email,
      amount: breakdown.total,
      reference: order.payment!.providerRef!,
    });
    await this.prisma.payment.update({
      where: { id: order.payment!.id },
      data: { authUrl: init.authorizationUrl },
    });

    return {
      order: this.orderSummary(order),
      payment: {
        method: order.payment!.method,
        status: order.payment!.status,
        reference: init.reference,
        authorizationUrl: init.authorizationUrl,
        simulated: init.simulated,
      },
      message: 'Order created — complete payment to confirm.',
    };
  }

  async byRef(userId: string, ref: string) {
    const order = await this.prisma.order.findUnique({
      where: { ref },
      include: { items: true, payment: true, shipment: true },
    });
    if (!order || order.customerId !== userId) throw new NotFoundException('Order not found');
    return this.orderDetail(order);
  }

  async list(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { customerId: userId },
      include: { payment: true },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((o) => this.orderSummary(o));
  }

  /** Public tracking by reference — no auth, limited fields. */
  async track(ref: string) {
    const order = await this.prisma.order.findUnique({
      where: { ref },
      include: { shipment: true, items: { select: { titleSnapshot: true, quantity: true } } },
    });
    if (!order) throw new NotFoundException('No order with that reference');

    return {
      ref: order.ref,
      status: order.status,
      placedAt: order.createdAt,
      confirmedAt: order.confirmedAt,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      courier: order.shipment?.courier ?? null,
      trackingNumber: order.shipment?.trackingNumber ?? null,
      estimatedDelivery: order.shipment?.estimatedDelivery ?? null,
      items: order.items,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async loadCartItems(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true }, orderBy: { id: 'asc' } } },
    });
    return cart?.items ?? [];
  }

  private channelFor(dto: PlaceOrderDto): OrderChannel {
    if (dto.promoCode || dto.influencerCode) return OrderChannel.INFLUENCER;
    if (dto.affiliateCode) return OrderChannel.AFFILIATE;
    return OrderChannel.WEB;
  }

  private newRef(): string {
    return `DNL-${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
  }

  private orderSummary(o: {
    ref: string;
    status: OrderStatus;
    channel: OrderChannel;
    total: Prisma.Decimal;
    createdAt: Date;
    payment?: { status: PaymentStatus; method: PaymentMethod } | null;
  }) {
    return {
      ref: o.ref,
      status: o.status,
      channel: o.channel,
      total: o.total,
      createdAt: o.createdAt,
      payment: o.payment ? { status: o.payment.status, method: o.payment.method } : null,
    };
  }

  private orderDetail(o: Prisma.OrderGetPayload<{
    include: { items: true; payment: true; shipment: true };
  }>) {
    return {
      ref: o.ref,
      status: o.status,
      channel: o.channel,
      fulfilmentMode: o.fulfilmentMode,
      contact: o.contact,
      deliveryAddress: o.deliveryAddress,
      subtotal: o.subtotal,
      giftAddon: o.giftAddon,
      deliveryFee: o.deliveryFee,
      tax: o.tax,
      total: o.total,
      createdAt: o.createdAt,
      confirmedAt: o.confirmedAt,
      items: o.items.map((i) => ({
        title: i.titleSnapshot,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        giftWrap: i.giftWrap,
        totalPrice: i.totalPrice,
      })),
      payment: o.payment
        ? { method: o.payment.method, status: o.payment.status, reference: o.payment.providerRef }
        : null,
      shipment: o.shipment,
    };
  }
}
