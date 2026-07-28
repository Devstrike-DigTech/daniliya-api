import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CommissionMode,
  Prisma,
  ProductStatus,
  ProductVariantType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Customer-facing price: base price plus the ADD_ON commission markup. */
function displayPrice(p: {
  price: Prisma.Decimal;
  commissionRate: Prisma.Decimal;
  commissionMode: CommissionMode;
}): Prisma.Decimal {
  if (p.commissionMode !== CommissionMode.ADD_ON) return p.price;
  return p.price
    .plus(p.price.times(p.commissionRate).dividedBy(100))
    .toDecimalPlaces(2);
}

export interface CatalogQuery {
  q?: string;
  category?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public catalogue — only ACTIVE products are ever exposed. */
  async list(query: CatalogQuery) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(60, Math.max(1, query.limit ?? 20));

    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.ACTIVE,
      ...(query.category ? { category: query.category } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { images: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: rows.map((p) => this.toCard(p)),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async categories() {
    const rows = await this.prisma.product.findMany({
      where: { status: ProductStatus.ACTIVE, category: { not: null } },
      distinct: ['category'],
      select: { category: true },
    });
    return rows.map((r) => r.category).filter(Boolean);
  }

  /**
   * The product the admin designated as the storefront "Builder's Handbook".
   * Returned whatever its status, so the hero can show its title/image/copy
   * even while it's a draft — with `available` telling the UI whether it can be
   * bought. Null when no product is featured.
   */
  async featuredBook() {
    const product = await this.prisma.product.findFirst({
      where: { isFeaturedBook: true },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!product) return null;

    return {
      id: product.id,
      slug: product.slug,
      title: product.title,
      description: product.description,
      price: displayPrice(product),
      images: product.images.map((i) => i.url),
      status: product.status,
      available:
        product.status === ProductStatus.ACTIVE && product.stockQuantity > 0,
    };
  }

  async bySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: ProductStatus.ACTIVE },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { orderBy: { sortOrder: 'asc' } },
        vendor: { select: { businessName: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Sizes carry the same ADD_ON markup as the base product, applied per row.
    const variants = product.variants.map((v) => ({
      id: v.id,
      name: v.name,
      price: displayPrice({ ...product, price: v.price }),
      inStock: v.stockQuantity > 0,
      stockQuantity: v.stockQuantity,
    }));
    const inStock = product.variantType
      ? variants.some((v) => v.inStock)
      : product.stockQuantity > 0;

    return {
      id: product.id,
      slug: product.slug,
      title: product.title,
      description: product.description,
      // For a sized product this is the lowest size — the "from" price.
      price: displayPrice(product),
      variantType: product.variantType,
      variants,
      category: product.category,
      inStock,
      stockQuantity: product.stockQuantity,
      vendor: product.vendor?.businessName ?? 'Daniliya',
      images: product.images.map((i) => i.url),
    };
  }

  private toCard(p: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    price: Prisma.Decimal;
    commissionRate: Prisma.Decimal;
    commissionMode: CommissionMode;
    variantType: ProductVariantType | null;
    category: string | null;
    stockQuantity: number;
    images: { url: string }[];
  }) {
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      blurb: p.description,
      // For a sized product this is the lowest size; `fromPrice` tells the card
      // to show it as "from ₦X".
      price: displayPrice(p),
      fromPrice: p.variantType !== null,
      category: p.category,
      inStock: p.stockQuantity > 0,
      image: p.images[0]?.url ?? null,
    };
  }
}
