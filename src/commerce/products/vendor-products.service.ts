import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/vendor-product.dto';

@Injectable()
export class VendorProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const vendor = await this.vendorOrThrow(userId);
    const rows = await this.prisma.product.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((p) => this.present(p));
  }

  async create(userId: string, dto: CreateProductDto) {
    const vendor = await this.vendorOrThrow(userId);
    if (!vendor.isApproved) {
      throw new ForbiddenException('Your vendor account is pending approval');
    }
    const product = await this.prisma.product.create({
      data: {
        vendorId: vendor.id,
        title: dto.title,
        slug: await this.uniqueSlug(dto.title),
        description: dto.description,
        price: new Prisma.Decimal(dto.price),
        stockQuantity: dto.stockQuantity,
        category: dto.category,
        status: ProductStatus.DRAFT,
      },
    });
    return this.present(product);
  }

  async update(userId: string, id: string, dto: UpdateProductDto) {
    await this.ownedProductOrThrow(userId, id);
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
        ...(dto.stockQuantity !== undefined ? { stockQuantity: dto.stockQuantity } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
      },
    });
    return this.present(updated);
  }

  async remove(userId: string, id: string) {
    const product = await this.ownedProductOrThrow(userId, id);
    // Don't hard-delete a product that has order history — soft-remove instead.
    const soldBefore = await this.prisma.orderItem.count({ where: { productId: id } });
    if (soldBefore > 0) {
      await this.prisma.product.update({ where: { id }, data: { status: ProductStatus.REMOVED } });
      return { id, removed: 'soft' };
    }
    await this.prisma.product.delete({ where: { id } });
    return { id, removed: 'hard' };
  }

  /** DRAFT → PENDING_REVIEW (admin then approves to ACTIVE). */
  async submit(userId: string, id: string) {
    const product = await this.ownedProductOrThrow(userId, id);
    if (product.status !== ProductStatus.DRAFT && product.status !== ProductStatus.REJECTED) {
      throw new BadRequestException(`Only a draft or rejected product can be submitted (is ${product.status})`);
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.PENDING_REVIEW, rejectedReason: null },
    });
    return this.present(updated);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async vendorOrThrow(userId: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({ where: { userId } });
    if (!vendor) throw new ForbiddenException('Not a vendor');
    return vendor;
  }

  private async ownedProductOrThrow(userId: string, id: string) {
    const vendor = await this.vendorOrThrow(userId);
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.vendorId !== vendor.id) throw new NotFoundException('Product not found');
    return product;
  }

  private async uniqueSlug(title: string): Promise<string> {
    const base = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
    for (let i = 0; i < 10; i++) {
      const slug = i === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      if (!(await this.prisma.product.findUnique({ where: { slug } }))) return slug;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }

  private present(p: {
    id: string;
    title: string;
    slug: string;
    price: Prisma.Decimal;
    stockQuantity: number;
    category: string | null;
    status: ProductStatus;
    rejectedReason: string | null;
  }) {
    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      price: p.price,
      stockQuantity: p.stockQuantity,
      category: p.category,
      status: p.status,
      rejectedReason: p.rejectedReason,
    };
  }
}
