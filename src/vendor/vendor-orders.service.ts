import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderChannel, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MarkShippedDto } from './dto/vendor.dto';

/** Orders a vendor may act on — anything earlier is not theirs to fulfil yet. */
const FULFILLABLE: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
];

@Injectable()
export class VendorOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Orders containing at least one of this vendor's products.
   *
   * A vendor only ever sees their own lines and the subtotal those lines come
   * to — never the order's grand total, which can include another vendor's
   * items plus platform delivery and tax. PENDING orders are excluded: payment
   * has not cleared, so there is nothing to pack.
   */
  async list(userId: string) {
    const vendor = await this.vendorOrThrow(userId);

    const orders = await this.prisma.order.findMany({
      where: {
        status: { notIn: [OrderStatus.PENDING] },
        items: { some: { product: { vendorId: vendor.id } } },
      },
      include: {
        shipment: true,
        items: {
          include: {
            product: {
              select: {
                vendorId: true,
                slug: true,
                images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((o) => this.present(o, vendor.id));
  }

  async byRef(userId: string, ref: string) {
    const vendor = await this.vendorOrThrow(userId);
    const order = await this.prisma.order.findUnique({
      where: { ref },
      include: {
        shipment: true,
        payment: true,
        items: {
          include: {
            product: {
              select: {
                vendorId: true,
                slug: true,
                images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
              },
            },
          },
        },
      },
    });
    if (!order || !order.items.some((i) => i.product?.vendorId === vendor.id)) {
      throw new NotFoundException('Order not found');
    }

    return {
      ...this.present(order, vendor.id),
      // Needed to actually pack and send the parcel.
      deliveryAddress: order.deliveryAddress,
      contact: order.contact,
      notes: order.notes,
      // Lets the vendor confirm the money has cleared before they ship.
      payment: order.payment
        ? {
            method: order.payment.method,
            status: order.payment.status,
            reference: order.payment.providerRef,
          }
        : null,
    };
  }

  /**
   * Record the despatch of an order.
   *
   * LIMITATION: Shipment is unique per order, so an order split across two
   * vendors shares a single shipment record — whichever vendor ships first owns
   * the courier and tracking number. Per-vendor fulfilment would need a
   * shipment per vendor (or per order item); flagged rather than silently
   * mis-modelled.
   */
  async markShipped(userId: string, ref: string, dto: MarkShippedDto) {
    const vendor = await this.vendorOrThrow(userId);
    const order = await this.prisma.order.findUnique({
      where: { ref },
      include: {
        items: { include: { product: { select: { vendorId: true } } } },
        shipment: true,
      },
    });
    if (!order || !order.items.some((i) => i.product?.vendorId === vendor.id)) {
      throw new NotFoundException('Order not found');
    }
    if (!FULFILLABLE.includes(order.status)) {
      throw new BadRequestException(
        order.status === OrderStatus.PENDING
          ? 'This order has not been paid for yet'
          : `A ${order.status.toLowerCase()} order cannot be shipped`,
      );
    }

    const estimatedDelivery = dto.estimatedDelivery
      ? new Date(dto.estimatedDelivery)
      : null;

    const [, updated] = await this.prisma.$transaction([
      this.prisma.shipment.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          courier: dto.courier,
          trackingNumber: dto.trackingNumber ?? null,
          estimatedDelivery,
        },
        update: {
          courier: dto.courier,
          trackingNumber: dto.trackingNumber ?? null,
          ...(estimatedDelivery ? { estimatedDelivery } : {}),
        },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.SHIPPED,
          // Keep the first despatch time if this is a correction.
          shippedAt: order.shippedAt ?? new Date(),
        },
        include: {
          shipment: true,
          items: {
            include: {
            product: {
              select: {
                vendorId: true,
                slug: true,
                images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
              },
            },
          },
          },
        },
      }),
    ]);

    return this.present(updated, vendor.id);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private present(
    order: {
      ref: string;
      status: OrderStatus;
      channel: OrderChannel;
      fulfilmentMode: string;
      createdAt: Date;
      confirmedAt: Date | null;
      shippedAt: Date | null;
      deliveredAt: Date | null;
      contact: Prisma.JsonValue;
      shipment: {
        courier: string | null;
        trackingNumber: string | null;
        estimatedDelivery: Date | null;
      } | null;
      items: {
        titleSnapshot: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
        totalPrice: Prisma.Decimal;
        product: {
          vendorId: string | null;
          slug: string;
          images?: { url: string }[];
        } | null;
      }[];
    },
    vendorId: string,
  ) {
    const mine = order.items.filter((i) => i.product?.vendorId === vendorId);
    const subtotal = mine.reduce(
      (acc, i) => acc.plus(i.totalPrice),
      new Prisma.Decimal(0),
    );
    const contact = (order.contact ?? {}) as { fullName?: string };

    return {
      ref: order.ref,
      status: order.status,
      /** WEB / AFFILIATE / INFLUENCER — how the sale was attributed. */
      channel: order.channel,
      fulfilmentMode: order.fulfilmentMode,
      placedAt: order.createdAt,
      confirmedAt: order.confirmedAt,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      customerName: contact.fullName ?? null,
      /** This vendor's lines only. */
      items: mine.map((i) => ({
        title: i.titleSnapshot,
        slug: i.product?.slug ?? null,
        image: i.product?.images?.[0]?.url ?? null,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.totalPrice,
      })),
      /** What this vendor's lines come to — NOT the order total. */
      vendorSubtotal: subtotal,
      shipment: order.shipment
        ? {
            courier: order.shipment.courier,
            trackingNumber: order.shipment.trackingNumber,
            estimatedDelivery: order.shipment.estimatedDelivery,
          }
        : null,
    };
  }

  private async vendorOrThrow(userId: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!vendor) throw new ForbiddenException('Not a vendor');
    if (!vendor.isApproved)
      throw new ForbiddenException('Your vendor account is pending approval');
    return vendor;
  }
}
