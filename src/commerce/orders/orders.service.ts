import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CommissionMode,
  FulfilmentMode,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ProductStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CommissionsService } from '../../commissions/commissions.service';
import { MailService } from '../../notifications/mail.service';
import { PaystackService } from '../../payments/paystack.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing.service';
import {
  ContactDto,
  GuestItemDto,
  GuestQuoteDto,
  PlaceGuestOrderDto,
  PlaceOrderDto,
  QuoteDto,
} from './dto/orders.dto';

/**
 * A priced line, however it was sourced — a server-side cart for signed-in
 * buyers, or the request body for guests. Both paths converge here so pricing
 * and stock rules can never diverge between them.
 */
type ResolvedItem = {
  productId: string;
  quantity: number;
  giftWrap: boolean;
  giftMeta?: Prisma.JsonValue | null;
  /** The chosen size, or null for single-price products. */
  variantId: string | null;
  variantName: string | null;
  /** Seller's price for what was chosen — the variant's price, or the product's. */
  basePrice: Prisma.Decimal;
  /** Stock available for what was chosen (variant stock or product stock). */
  availableStock: number;
  product: {
    id: string;
    title: string;
    price: Prisma.Decimal;
    commissionRate: Prisma.Decimal;
    commissionMode: CommissionMode;
    status: ProductStatus;
    stockQuantity: number;
  };
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly paystack: PaystackService,
    private readonly commissions: CommissionsService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  /**
   * Where Paystack returns the buyer after checkout — the storefront's success
   * page. Uses the origin the checkout was actually initiated from (so a payment
   * started on dev/staging/local returns to that same site), but only if it is
   * allow-listed; otherwise it falls back to the configured WEB_APP_URL. The
   * allow-list guard stops a caller redirecting the post-payment buyer anywhere.
   */
  private successUrl(ref: string, returnOrigin?: string): string {
    const base = (
      this.safeOrigin(returnOrigin) ??
      this.config.get<string>('WEB_APP_URL') ??
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    return `${base}/order/success?ref=${encodeURIComponent(ref)}`;
  }

  /** The URL's origin iff it is in the CORS allow-list, else undefined. */
  private safeOrigin(url?: string): string | undefined {
    if (!url) return undefined;
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return undefined;
    }
    const allowed = (this.config.get<string>('CORS_ORIGIN') ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    return allowed.includes(origin) ? origin : undefined;
  }

  /**
   * What the customer is charged per unit. For ADD_ON products the platform
   * commission (commissionRate % of the set price) is added on top of the
   * seller's price; INCLUSIVE products are charged their price as-is. The base
   * price is preserved on the order item so vendor payout and profit stay tied
   * to the seller's price, not the marked-up amount.
   */
  private effectiveUnitPrice(product: {
    price: Prisma.Decimal;
    commissionRate: Prisma.Decimal;
    commissionMode: CommissionMode;
  }): Prisma.Decimal {
    if (product.commissionMode !== CommissionMode.ADD_ON) return product.price;
    const markup = product.price.times(product.commissionRate).dividedBy(100);
    return product.price.plus(markup).toDecimalPlaces(2);
  }

  /** Charged unit price for a resolved line — markup applied to the chosen
   *  size's price (or the product's, for single-price items). */
  private itemUnit(i: ResolvedItem): Prisma.Decimal {
    return this.effectiveUnitPrice({
      price: i.basePrice,
      commissionRate: i.product.commissionRate,
      commissionMode: i.product.commissionMode,
    });
  }

  /** Server-side total for the current cart under a fulfilment mode. */
  async quote(userId: string, dto: QuoteDto) {
    const items = await this.loadCartItems(userId);
    if (items.length === 0) throw new BadRequestException('Your cart is empty');

    const breakdown = this.pricing.quote(
      items.map((i) => ({
        unitPrice: this.itemUnit(i),
        quantity: i.quantity,
        giftWrap: i.giftWrap,
      })),
      dto.mode,
    );
    return { mode: dto.mode, ...breakdown };
  }

  /** Same totals as `quote`, for a guest whose cart lives in the browser. */
  async guestQuote(dto: GuestQuoteDto) {
    const items = await this.loadGuestItems(dto.items);
    const breakdown = this.pricing.quote(
      items.map((i) => ({
        unitPrice: this.itemUnit(i),
        quantity: i.quantity,
        giftWrap: i.giftWrap,
      })),
      dto.mode,
    );
    return { mode: dto.mode, ...breakdown };
  }

  async place(userId: string, dto: PlaceOrderDto, returnOrigin?: string) {
    const items = await this.loadCartItems(userId);
    if (items.length === 0) throw new BadRequestException('Your cart is empty');
    return this.placeCore(userId, items, dto, {
      clearCartFor: userId,
      returnOrigin,
    });
  }

  /**
   * Checkout without an account. The order is attached to a passwordless GUEST
   * user keyed by the contact email, so registering with that same address
   * later claims the full order history — see AuthService.register.
   */
  async placeGuest(dto: PlaceGuestOrderDto, returnOrigin?: string) {
    const items = await this.loadGuestItems(dto.items);
    const customerId = await this.resolveGuestCustomer(dto.contact);
    return this.placeCore(customerId, items, dto, { returnOrigin });
  }

  private async placeCore(
    userId: string,
    items: ResolvedItem[],
    dto: PlaceOrderDto,
    opts: { clearCartFor?: string; returnOrigin?: string },
  ) {
    if (dto.mode === FulfilmentMode.DELIVERY && !dto.deliveryAddress) {
      throw new BadRequestException(
        'A delivery address is required for delivery orders',
      );
    }

    for (const it of items) {
      if (it.product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException(
          `"${it.product.title}" is no longer available`,
        );
      }
      if (it.availableStock < it.quantity) {
        throw new BadRequestException(
          it.variantName
            ? `"${it.product.title}" (${it.variantName}) is out of stock`
            : `Not enough stock for "${it.product.title}"`,
        );
      }
    }

    const breakdown = this.pricing.quote(
      items.map((i) => ({
        unitPrice: this.itemUnit(i),
        quantity: i.quantity,
        giftWrap: i.giftWrap,
      })),
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
          deliveryAddress: (dto.deliveryAddress ??
            null) as Prisma.InputJsonValue,
          contact: dto.contact as unknown as Prisma.InputJsonValue,
          confirmedAt: isPod ? new Date() : null,
          items: {
            create: items.map((i) => {
              const unit = this.itemUnit(i);
              return {
                productId: i.productId,
                variantId: i.variantId,
                variantName: i.variantName,
                titleSnapshot: i.product.title,
                quantity: i.quantity,
                unitPrice: unit,
                baseUnitPrice: i.basePrice,
                giftWrap: i.giftWrap,
                giftMeta: i.giftMeta ?? undefined,
                totalPrice: unit.times(i.quantity),
              };
            }),
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

      // Reserve stock immediately so two buyers can't claim the last unit. For
      // a sized purchase, decrement the size AND the product aggregate (which is
      // the sum of the sizes) so the "from" price and in-stock flag stay right.
      for (const it of items) {
        if (it.variantId) {
          await tx.productVariant.update({
            where: { id: it.variantId },
            data: { stockQuantity: { decrement: it.quantity } },
          });
        }
        await tx.product.update({
          where: { id: it.productId },
          data: { stockQuantity: { decrement: it.quantity } },
        });
      }

      // POD: order is confirmed now, so the cart can be cleared. Card orders keep
      // the cart until the webhook confirms payment. Guests have no server-side
      // cart, so there is nothing to clear for them.
      if (isPod && opts.clearCartFor) {
        await tx.cartItem.deleteMany({
          where: { cart: { userId: opts.clearCartFor } },
        });
      }

      return created;
    });

    if (isPod) {
      // POD is confirmed on placement, so attribute commissions now.
      await this.commissions.accrueForOrder(order.id);
      // Card orders are confirmed by PaymentsService.markPaid, which sends their
      // confirmation email; POD is confirmed here, so send it here.
      await this.sendConfirmationEmail(order.ref, dto, items, breakdown.total);
      return {
        order: this.orderSummary(order),
        payment: {
          method: order.payment!.method,
          status: order.payment!.status,
        },
        message: 'Order placed — pay on delivery.',
      };
    }

    const init = await this.paystack.initializeTransaction({
      email: dto.contact.email,
      amount: breakdown.total,
      reference: order.payment!.providerRef!,
      // Paystack sends the buyer back here after paying, appending ?reference=…;
      // the success page verifies it and confirms the order without waiting on
      // the webhook (which can't reach a localhost API at all).
      callbackUrl: this.successUrl(order.ref, opts.returnOrigin),
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
    if (!order || order.customerId !== userId)
      throw new NotFoundException('Order not found');
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
      include: {
        shipment: true,
        items: { select: { titleSnapshot: true, variantName: true, quantity: true } },
      },
    });
    if (!order) throw new NotFoundException('No order with that reference');

    return {
      ref: order.ref,
      status: order.status,
      // So the tracking page can say "ready for pickup" instead of "shipped".
      fulfilmentMode: order.fulfilmentMode,
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

  /**
   * Email the buyer their order confirmation. Best-effort: a mail failure must
   * never fail the checkout that already succeeded, so it is caught and logged.
   */
  private async sendConfirmationEmail(
    ref: string,
    dto: PlaceOrderDto,
    items: ResolvedItem[],
    total: Prisma.Decimal,
  ): Promise<void> {
    const to = MailService.recipientFor(dto.contact);
    if (!to) return;
    try {
      await this.mail.sendOrderConfirmation(to, {
        ref,
        total: total.toString(),
        paymentMethod: dto.paymentMethod,
        fulfilmentMode: dto.mode,
        items: items.map((i) => ({
          title: i.product.title,
          quantity: i.quantity,
        })),
      });
    } catch (e) {
      this.logger.warn(
        `Order confirmation email for ${ref} failed: ${(e as Error).message}`,
      );
    }
  }

  private async loadCartItems(userId: string): Promise<ResolvedItem[]> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: { include: { product: true }, orderBy: { id: 'asc' } },
      },
    });
    // The signed-in server cart is single-price (no sizes) for now.
    return (cart?.items ?? []).map((it) => ({
      productId: it.productId,
      quantity: it.quantity,
      giftWrap: it.giftWrap,
      giftMeta: it.giftMeta,
      variantId: null,
      variantName: null,
      basePrice: it.product.price,
      availableStock: it.product.stockQuantity,
      product: it.product,
    }));
  }

  /**
   * Turn client-supplied lines into priced items. Quantities come from the
   * request; prices and availability are always re-read from the database, so
   * a tampered payload cannot change what the buyer is charged.
   */
  private async loadGuestItems(lines: GuestItemDto[]): Promise<ResolvedItem[]> {
    const ids = [...new Set(lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: { variants: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    return lines.map((line) => {
      const product = byId.get(line.productId);
      if (!product)
        throw new BadRequestException(
          'One of the items is no longer available',
        );

      // A sized product must be bought by a specific size; a single-price one
      // must not carry a size.
      if (product.variantType) {
        const variant = product.variants.find((v) => v.id === line.variantId);
        if (!variant)
          throw new BadRequestException(
            `Choose a size for "${product.title}"`,
          );
        return {
          productId: product.id,
          quantity: line.quantity,
          giftWrap: line.giftWrap ?? false,
          giftMeta: null,
          variantId: variant.id,
          variantName: variant.name,
          basePrice: variant.price,
          availableStock: variant.stockQuantity,
          product,
        };
      }

      return {
        productId: product.id,
        quantity: line.quantity,
        giftWrap: line.giftWrap ?? false,
        giftMeta: null,
        variantId: null,
        variantName: null,
        basePrice: product.price,
        availableStock: product.stockQuantity,
        product,
      };
    });
  }

  /**
   * Find or create the User a guest order belongs to. An existing account with
   * the same email is reused, so the order shows up in that buyer's history;
   * otherwise a passwordless GUEST row is created for them to claim later.
   * Phone is deliberately left off the row (it is unique on User and would
   * collide) — it lives in the order's contact JSON.
   */
  private async resolveGuestCustomer(contact: ContactDto): Promise<string> {
    const email = contact.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing.id;

    const [firstName, ...rest] = contact.fullName.trim().split(/\s+/);
    const created = await this.prisma.user.create({
      data: {
        email,
        firstName: firstName || 'Guest',
        lastName: rest.join(' ') || '—',
        role: UserRole.CUSTOMER,
        status: UserStatus.GUEST,
      },
    });
    return created.id;
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
      payment: o.payment
        ? { status: o.payment.status, method: o.payment.method }
        : null,
    };
  }

  private orderDetail(
    o: Prisma.OrderGetPayload<{
      include: { items: true; payment: true; shipment: true };
    }>,
  ) {
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
        // The buyer needs this to review what they bought — titleSnapshot is a
        // point-in-time copy and cannot be matched back to a product safely.
        productId: i.productId,
        title: i.titleSnapshot,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        giftWrap: i.giftWrap,
        totalPrice: i.totalPrice,
      })),
      payment: o.payment
        ? {
            method: o.payment.method,
            status: o.payment.status,
            reference: o.payment.providerRef,
          }
        : null,
      shipment: o.shipment,
    };
  }
}
