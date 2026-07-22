import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateVerticalDto, UpdateVerticalDto } from './dto/vertical.dto';

@Injectable()
export class VerticalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Public service verticals (inactive ones flagged comingSoon, not hidden). */
  async list() {
    const rows = await this.prisma.vertical.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((v) => ({
      slug: v.slug,
      name: v.name,
      description: v.description,
      heroImage: v.heroImage,
      icon: v.icon,
      comingSoon: !v.isActive,
    }));
  }

  async bySlug(slug: string) {
    const v = await this.prisma.vertical.findUnique({
      where: { slug },
      include: {
        services: { orderBy: { sortOrder: 'asc' } },
        portfolioItems: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!v) throw new NotFoundException('Service not found');
    return {
      slug: v.slug,
      name: v.name,
      description: v.description,
      heroImage: v.heroImage,
      comingSoon: !v.isActive,
      services: v.services.map((s) => ({
        name: s.name,
        description: s.description,
      })),
      portfolio: v.portfolioItems.map((p) => ({
        imageUrl: p.imageUrl,
        caption: p.caption,
      })),
    };
  }

  // ── Admin management ──────────────────────────────────────────────────────

  /** Every vertical, active or not, with how many bookings/quotes it holds. */
  async adminList() {
    const rows = await this.prisma.vertical.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { bookings: true, quoteRequests: true } },
      },
    });
    return rows.map((v) => ({
      id: v.id,
      slug: v.slug,
      name: v.name,
      description: v.description,
      isActive: v.isActive,
      sortOrder: v.sortOrder,
      bookings: v._count.bookings,
      quoteRequests: v._count.quoteRequests,
    }));
  }

  async create(dto: CreateVerticalDto, adminId?: string, ip?: string) {
    const slug = await this.uniqueSlug(dto.name);
    const max = await this.prisma.vertical.aggregate({
      _max: { sortOrder: true },
    });
    const created = await this.prisma.vertical.create({
      data: {
        name: dto.name.trim(),
        slug,
        description: dto.description?.trim() || null,
        isActive: dto.isActive ?? true,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'service.create',
      targetType: 'Vertical',
      targetId: created.id,
      after: { slug: created.slug, name: created.name, isActive: created.isActive },
      ip,
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateVerticalDto,
    adminId?: string,
    ip?: string,
  ) {
    const before = await this.prisma.vertical.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Service not found');
    // Slug stays fixed on rename so existing storefront links keep resolving.
    const updated = await this.prisma.vertical.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'service.update',
      targetType: 'Vertical',
      targetId: id,
      before: { name: before.name, isActive: before.isActive },
      after: { name: updated.name, isActive: updated.isActive },
      ip,
    });
    return updated;
  }

  /**
   * Delete a vertical. Refused once it has bookings or quote requests — that
   * history references it, so deactivate instead (isActive:false hides it from
   * the storefront without orphaning records).
   */
  async remove(id: string, adminId?: string, ip?: string) {
    const v = await this.prisma.vertical.findUnique({
      where: { id },
      include: {
        _count: { select: { bookings: true, quoteRequests: true } },
      },
    });
    if (!v) throw new NotFoundException('Service not found');
    if (v._count.bookings > 0 || v._count.quoteRequests > 0) {
      throw new BadRequestException(
        'This service has booking history. Deactivate it instead of deleting.',
      );
    }
    await this.prisma.vertical.delete({ where: { id } });
    await this.audit.record({
      actorId: adminId,
      action: 'service.delete',
      targetType: 'Vertical',
      targetId: id,
      before: { slug: v.slug, name: v.name },
      ip,
    });
    return { deleted: true };
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /** A slug from the name, suffixed -2, -3… if that base is already taken. */
  private async uniqueSlug(name: string): Promise<string> {
    const base = this.slugify(name) || 'service';
    let slug = base;
    for (let n = 2; ; n++) {
      const clash = await this.prisma.vertical.findUnique({ where: { slug } });
      if (!clash) return slug;
      slug = `${base}-${n}`;
    }
  }
}
