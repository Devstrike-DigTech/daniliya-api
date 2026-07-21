import { Injectable, NotFoundException } from '@nestjs/common';
import { CommissionMode, Prisma, ProductStatus } from '@prisma/client';
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
        vendor: { select: { businessName: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    return {
      id: product.id,
      slug: product.slug,
      title: product.title,
      description: product.description,
      price: displayPrice(product),
      category: product.category,
      inStock: product.stockQuantity > 0,
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
    category: string | null;
    stockQuantity: number;
    images: { url: string }[];
  }) {
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      blurb: p.description,
      price: displayPrice(p),
      category: p.category,
      inStock: p.stockQuantity > 0,
      image: p.images[0]?.url ?? null,
    };
  }
}
