import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ResourceType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateResourceDto, UpdateResourceDto } from './dto/resource.dto';

/**
 * Affiliate marketing resources — brand creatives, ready-to-send scripts and
 * training-video links. A resource is either global (productId null, applies to
 * every product) or scoped to one product. Admins author them; affiliates read
 * the published ones.
 */
@Injectable()
export class ResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Affiliate read ────────────────────────────────────────────────────────

  /**
   * Landing data: the global resources every affiliate can use, plus the list
   * of products that have their own published resources (for the per-product
   * kits). Only published resources count.
   */
  async affiliateLanding() {
    const [globals, scoped] = await Promise.all([
      this.prisma.affiliateResource.findMany({
        where: { isPublished: true, productId: null },
        orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
      }),
      this.prisma.affiliateResource.groupBy({
        by: ['productId'],
        where: { isPublished: true, productId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const productIds = scoped
      .map((s) => s.productId)
      .filter((id): id is string => id !== null);
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            slug: true,
            title: true,
            images: {
              orderBy: { sortOrder: 'asc' },
              take: 1,
              select: { url: true },
            },
          },
        })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));

    return {
      global: globals.map((r) => this.shape(r)),
      products: scoped
        .map((s) => {
          const p = s.productId ? byId.get(s.productId) : undefined;
          if (!p) return null;
          return {
            id: p.id,
            slug: p.slug,
            title: p.title,
            image: p.images[0]?.url ?? null,
            count: s._count._all,
          };
        })
        .filter(Boolean),
    };
  }

  /**
   * A product's kit: its own published resources plus the global ones (which
   * apply everywhere), so an affiliate on a product page sees everything usable.
   */
  async productKit(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, slug: true, title: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const resources = await this.prisma.affiliateResource.findMany({
      where: {
        isPublished: true,
        OR: [{ productId }, { productId: null }],
      },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
    });

    return { product, resources: resources.map((r) => this.shape(r)) };
  }

  // ── Admin management ──────────────────────────────────────────────────────

  /** Every resource, published or not, with its product title for the list. */
  async adminList() {
    const rows = await this.prisma.affiliateResource.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: { product: { select: { title: true, slug: true } } },
    });
    return rows.map((r) => ({
      ...this.shape(r),
      productTitle: r.product?.title ?? null,
      productSlug: r.product?.slug ?? null,
    }));
  }

  async create(dto: CreateResourceDto, adminId?: string, ip?: string) {
    this.assertTypeFields(dto.type, dto);
    if (dto.productId) await this.assertProduct(dto.productId);

    const max = await this.prisma.affiliateResource.aggregate({
      where: { productId: dto.productId ?? null, type: dto.type },
      _max: { sortOrder: true },
    });

    const created = await this.prisma.affiliateResource.create({
      data: {
        type: dto.type,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        productId: dto.productId ?? null,
        fileUrl: dto.fileUrl?.trim() || null,
        fileFormat: dto.fileFormat?.trim() || null,
        fileMeta: dto.fileMeta?.trim() || null,
        body: dto.body?.trim() || null,
        videoUrl: dto.videoUrl?.trim() || null,
        duration: dto.duration?.trim() || null,
        isPublished: dto.isPublished ?? true,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'resource.create',
      targetType: 'AffiliateResource',
      targetId: created.id,
      after: { type: created.type, title: created.title, productId: created.productId },
      ip,
    });
    return this.shape(created);
  }

  async update(
    id: string,
    dto: UpdateResourceDto,
    adminId?: string,
    ip?: string,
  ) {
    const before = await this.prisma.affiliateResource.findUnique({
      where: { id },
    });
    if (!before) throw new NotFoundException('Resource not found');
    if (dto.productId) await this.assertProduct(dto.productId);

    // Re-check required fields against the (immutable) type when a type-specific
    // field is being cleared.
    this.assertTypeFields(before.type, { ...before, ...dto });

    const updated = await this.prisma.affiliateResource.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        ...(dto.productId !== undefined
          ? { productId: dto.productId ?? null }
          : {}),
        ...(dto.fileUrl !== undefined ? { fileUrl: dto.fileUrl.trim() || null } : {}),
        ...(dto.fileFormat !== undefined
          ? { fileFormat: dto.fileFormat.trim() || null }
          : {}),
        ...(dto.fileMeta !== undefined
          ? { fileMeta: dto.fileMeta.trim() || null }
          : {}),
        ...(dto.body !== undefined ? { body: dto.body.trim() || null } : {}),
        ...(dto.videoUrl !== undefined
          ? { videoUrl: dto.videoUrl.trim() || null }
          : {}),
        ...(dto.duration !== undefined
          ? { duration: dto.duration.trim() || null }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'resource.update',
      targetType: 'AffiliateResource',
      targetId: id,
      before: { title: before.title, isPublished: before.isPublished },
      after: { title: updated.title, isPublished: updated.isPublished },
      ip,
    });
    return this.shape(updated);
  }

  async remove(id: string, adminId?: string, ip?: string) {
    const r = await this.prisma.affiliateResource.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Resource not found');
    await this.prisma.affiliateResource.delete({ where: { id } });
    await this.audit.record({
      actorId: adminId,
      action: 'resource.delete',
      targetType: 'AffiliateResource',
      targetId: id,
      before: { type: r.type, title: r.title },
      ip,
    });
    return { deleted: true };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Flat, portal-ready shape (drops nulls the client doesn't need to branch on). */
  private shape(r: {
    id: string;
    type: ResourceType;
    title: string;
    description: string | null;
    productId: string | null;
    fileUrl: string | null;
    fileFormat: string | null;
    fileMeta: string | null;
    body: string | null;
    videoUrl: string | null;
    duration: string | null;
    isPublished: boolean;
    sortOrder: number;
  }) {
    return {
      id: r.id,
      type: r.type,
      title: r.title,
      description: r.description,
      productId: r.productId,
      fileUrl: r.fileUrl,
      fileFormat: r.fileFormat,
      fileMeta: r.fileMeta,
      body: r.body,
      videoUrl: r.videoUrl,
      duration: r.duration,
      isPublished: r.isPublished,
      sortOrder: r.sortOrder,
    };
  }

  /** Each type needs its payload — a creative without a file can't be downloaded. */
  private assertTypeFields(
    type: ResourceType,
    v: { fileUrl?: string | null; body?: string | null; videoUrl?: string | null },
  ) {
    if (type === ResourceType.CREATIVE && !v.fileUrl?.trim()) {
      throw new BadRequestException('A creative needs an uploaded file.');
    }
    if (type === ResourceType.SCRIPT && !v.body?.trim()) {
      throw new BadRequestException('A script needs its copy text.');
    }
    if (type === ResourceType.VIDEO && !v.videoUrl?.trim()) {
      throw new BadRequestException('A video needs a link.');
    }
  }

  private async assertProduct(productId: string) {
    const exists = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('That product does not exist.');
  }
}
