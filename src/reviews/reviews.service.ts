import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Review, ReviewStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateReviewDto,
  FlagReviewDto,
  RespondReviewDto,
} from './dto/review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Only buyers of a delivered/confirmed order for the product may review it, once. */
  async create(userId: string, dto: CreateReviewDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const purchased = await this.prisma.order.findFirst({
      where: {
        customerId: userId,
        status: {
          in: [
            OrderStatus.CONFIRMED,
            OrderStatus.DELIVERED,
            OrderStatus.COMPLETED,
          ],
        },
        items: { some: { productId: dto.productId } },
      },
      select: { id: true },
    });
    if (!purchased) {
      throw new ForbiddenException(
        'You can only review products you have purchased',
      );
    }

    const existing = await this.prisma.review.findFirst({
      where: { authorId: userId, productId: dto.productId },
    });
    if (existing)
      throw new BadRequestException('You have already reviewed this product');

    const review = await this.prisma.review.create({
      data: {
        authorId: userId,
        productId: dto.productId,
        vendorId: product.vendorId,
        orderId: purchased.id,
        rating: dto.rating,
        body: dto.body,
      },
    });
    return this.present(review);
  }

  /** Public — published reviews for a product + rating summary. */
  async forProduct(productId: string) {
    const [rows, agg] = await Promise.all([
      this.prisma.review.findMany({
        where: { productId, status: ReviewStatus.PUBLISHED },
        include: { author: { select: { firstName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.aggregate({
        where: { productId, status: ReviewStatus.PUBLISHED },
        _avg: { rating: true },
        _count: true,
      }),
    ]);

    return {
      summary: { average: agg._avg.rating ?? 0, count: agg._count },
      reviews: rows.map((r) => ({
        reviewer: r.author.firstName,
        rating: r.rating,
        body: r.body,
        response: r.responseBody,
        createdAt: r.createdAt,
      })),
    };
  }

  // ── Vendor ────────────────────────────────────────────────────────────

  async respond(userId: string, reviewId: string, dto: RespondReviewDto) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!vendor) throw new ForbiddenException('Not a vendor');

    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
    });
    if (!review || review.vendorId !== vendor.id)
      throw new NotFoundException('Review not found');

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { responseBody: dto.body, responseAt: new Date() },
    });
    return this.present(updated);
  }

  // ── Admin moderation ──────────────────────────────────────────────────

  async list(status?: ReviewStatus) {
    const rows = await this.prisma.review.findMany({
      where: status ? { status } : undefined,
      include: {
        author: { select: { firstName: true } },
        product: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      ...this.present(r),
      reviewer: r.author.firstName,
      product: r.product?.title,
    }));
  }

  flag(adminId: string, reviewId: string, dto: FlagReviewDto, ip?: string) {
    return this.moderate(
      adminId,
      reviewId,
      ReviewStatus.FLAGGED,
      ip,
      dto.reason,
    );
  }

  keep(adminId: string, reviewId: string, ip?: string) {
    return this.moderate(adminId, reviewId, ReviewStatus.PUBLISHED, ip);
  }

  remove(adminId: string, reviewId: string, ip?: string) {
    return this.moderate(adminId, reviewId, ReviewStatus.REMOVED, ip);
  }

  private async moderate(
    adminId: string,
    reviewId: string,
    to: ReviewStatus,
    ip?: string,
    reason?: string,
  ) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
    });
    if (!review) throw new NotFoundException('Review not found');

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        status: to,
        flagReason: to === ReviewStatus.FLAGGED ? reason : review.flagReason,
      },
    });

    await this.audit.record({
      actorId: adminId,
      action: `Review ${to.toLowerCase()}`,
      targetType: 'Review',
      targetId: reviewId,
      before: { status: review.status },
      after: { status: to },
      ip,
    });
    return this.present(updated);
  }

  private present(r: Review) {
    return {
      id: r.id,
      productId: r.productId,
      rating: r.rating,
      body: r.body,
      status: r.status,
      // Why it was flagged. Stored on moderation but previously never returned,
      // so the reason one admin gave was invisible to everyone including them.
      flagReason: r.flagReason,
      response: r.responseBody,
      createdAt: r.createdAt,
    };
  }
}
