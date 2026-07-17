import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VerticalsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public service verticals (inactive ones flagged comingSoon, not hidden). */
  async list() {
    const rows = await this.prisma.vertical.findMany({ orderBy: { sortOrder: 'asc' } });
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
      services: v.services.map((s) => ({ name: s.name, description: s.description })),
      portfolio: v.portfolioItems.map((p) => ({ imageUrl: p.imageUrl, caption: p.caption })),
    };
  }
}
