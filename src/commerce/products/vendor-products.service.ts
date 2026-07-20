import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
      include: { images: { orderBy: { sortOrder: 'asc' } } },
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
        costPrice:
          dto.costPrice !== undefined ? new Prisma.Decimal(dto.costPrice) : null,
        stockQuantity: dto.stockQuantity,
        category: dto.category,
        affiliateEligible: dto.affiliateEligible ?? true,
        influencerEligible: dto.influencerEligible ?? true,
        commissionMode: dto.commissionMode ?? undefined,
        status: ProductStatus.DRAFT,
        images: dto.imageUrls?.length
          ? {
              create: dto.imageUrls.map((url, sortOrder) => ({
                url,
                sortOrder,
              })),
            }
          : undefined,
      },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
    return this.present(product);
  }

  async update(userId: string, id: string, dto: UpdateProductDto) {
    await this.ownedProductOrThrow(userId, id);
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.price !== undefined
          ? { price: new Prisma.Decimal(dto.price) }
          : {}),
        ...(dto.costPrice !== undefined
          ? { costPrice: new Prisma.Decimal(dto.costPrice) }
          : {}),
        ...(dto.stockQuantity !== undefined
          ? { stockQuantity: dto.stockQuantity }
          : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.affiliateEligible !== undefined
          ? { affiliateEligible: dto.affiliateEligible }
          : {}),
        ...(dto.influencerEligible !== undefined
          ? { influencerEligible: dto.influencerEligible }
          : {}),
        ...(dto.commissionMode !== undefined
          ? { commissionMode: dto.commissionMode }
          : {}),
      },
    });

    // Images are replaced wholesale when the field is present: the form always
    // sends the full set it wants, so a removed image means a removed row.
    // Omitting the field leaves the existing images untouched.
    if (dto.imageUrls !== undefined) {
      await this.prisma.$transaction([
        this.prisma.productImage.deleteMany({ where: { productId: id } }),
        ...(dto.imageUrls.length
          ? [
              this.prisma.productImage.createMany({
                data: dto.imageUrls.map((url, sortOrder) => ({
                  productId: id,
                  url,
                  sortOrder,
                })),
              }),
            ]
          : []),
      ]);
    }

    const withImages = await this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
    return this.present(withImages);
  }

  async remove(userId: string, id: string) {
    const product = await this.ownedProductOrThrow(userId, id);
    // Don't hard-delete a product that has order history — soft-remove instead.
    const soldBefore = await this.prisma.orderItem.count({
      where: { productId: id },
    });
    if (soldBefore > 0) {
      await this.prisma.product.update({
        where: { id },
        data: { status: ProductStatus.REMOVED },
      });
      return { id, removed: 'soft' };
    }
    await this.prisma.product.delete({ where: { id } });
    return { id, removed: 'hard' };
  }

  /** DRAFT → PENDING_REVIEW (admin then approves to ACTIVE). */
  async submit(userId: string, id: string) {
    const product = await this.ownedProductOrThrow(userId, id);
    if (
      product.status !== ProductStatus.DRAFT &&
      product.status !== ProductStatus.REJECTED
    ) {
      throw new BadRequestException(
        `Only a draft or rejected product can be submitted (is ${product.status})`,
      );
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.PENDING_REVIEW, rejectedReason: null },
    });
    return this.present(updated);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async vendorOrThrow(userId: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!vendor) throw new ForbiddenException('Not a vendor');
    return vendor;
  }

  private async ownedProductOrThrow(userId: string, id: string) {
    const vendor = await this.vendorOrThrow(userId);
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.vendorId !== vendor.id)
      throw new NotFoundException('Product not found');
    return product;
  }

  private async uniqueSlug(title: string): Promise<string> {
    const base =
      title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'product';
    for (let i = 0; i < 10; i++) {
      const slug = i === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      if (!(await this.prisma.product.findUnique({ where: { slug } })))
        return slug;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }

  private present(p: {
    id: string;
    title: string;
    slug: string;
    price: Prisma.Decimal;
    costPrice?: Prisma.Decimal | null;
    stockQuantity: number;
    category: string | null;
    status: ProductStatus;
    rejectedReason: string | null;
    affiliateEligible?: boolean;
    influencerEligible?: boolean;
    commissionMode?: string;
    images?: { url: string }[];
  }) {
    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      price: p.price,
      costPrice: p.costPrice ?? null,
      stockQuantity: p.stockQuantity,
      category: p.category,
      status: p.status,
      rejectedReason: p.rejectedReason,
      affiliateEligible: p.affiliateEligible ?? true,
      influencerEligible: p.influencerEligible ?? true,
      commissionMode: p.commissionMode ?? 'INCLUSIVE',
      imageUrls: (p.images ?? []).map((i) => i.url),
    };
  }
}
