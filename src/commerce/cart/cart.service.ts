import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FulfilmentMode, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /** Returns the user's cart with a live delivery-mode price preview. */
  async get(userId: string) {
    const cart = await this.prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: {
        items: {
          include: { product: { include: { images: { take: 1, orderBy: { sortOrder: 'asc' } } } } },
          orderBy: { id: 'asc' },
        },
      },
    });

    const lines = cart.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      title: it.product.title,
      slug: it.product.slug,
      unitPrice: it.product.price,
      quantity: it.quantity,
      giftWrap: it.giftWrap,
      image: it.product.images[0]?.url ?? null,
      lineTotal: it.product.price.times(it.quantity),
      available: it.product.status === ProductStatus.ACTIVE && it.product.stockQuantity > 0,
    }));

    const preview = this.pricing.quote(
      lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, giftWrap: l.giftWrap })),
      FulfilmentMode.DELIVERY,
    );

    return { id: cart.id, items: lines, preview };
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException('Product not available');
    }

    const cart = await this.prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    const qty = dto.quantity ?? 1;
    const giftMeta = dto.giftMessage ? { message: dto.giftMessage } : undefined;

    // Adding an existing product increments quantity (idempotent add-to-cart).
    await this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: dto.productId } },
      create: {
        cartId: cart.id,
        productId: dto.productId,
        quantity: qty,
        giftWrap: dto.giftWrap ?? false,
        giftMeta,
      },
      update: {
        quantity: { increment: qty },
        ...(dto.giftWrap !== undefined ? { giftWrap: dto.giftWrap } : {}),
        ...(giftMeta ? { giftMeta } : {}),
      },
    });

    return this.get(userId);
  }

  async updateItem(userId: string, itemId: string, dto: UpdateCartItemDto) {
    await this.ownedItemOrThrow(userId, itemId);
    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: {
        ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
        ...(dto.giftWrap !== undefined ? { giftWrap: dto.giftWrap } : {}),
      },
    });
    return this.get(userId);
  }

  async removeItem(userId: string, itemId: string) {
    await this.ownedItemOrThrow(userId, itemId);
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.get(userId);
  }

  async clear(userId: string) {
    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (cart) await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.get(userId);
  }

  private async ownedItemOrThrow(userId: string, itemId: string) {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true },
    });
    if (!item || item.cart.userId !== userId) {
      throw new BadRequestException('Cart item not found');
    }
    return item;
  }
}
