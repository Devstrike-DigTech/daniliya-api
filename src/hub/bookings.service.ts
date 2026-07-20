import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Booking, BookingStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../notifications/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AcceptBookingDto,
  CancelBookingDto,
  CreateBookingDto,
} from './dto/booking.dto';

/** Allowed forward transitions for the booking lifecycle. */
const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  REQUESTED: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  CONFIRMED: [BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED],
  IN_PROGRESS: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** Public/authenticated quote request. userId is null for guests. */
  async create(dto: CreateBookingDto, userId: string | null) {
    let verticalId: string | null = null;
    if (dto.verticalSlug) {
      const vertical = await this.prisma.vertical.findUnique({
        where: { slug: dto.verticalSlug },
      });
      if (!vertical) throw new BadRequestException('Unknown service');
      verticalId = vertical.id;
    }

    const booking = await this.prisma.booking.create({
      data: {
        ref: this.newRef(),
        customerId: userId,
        verticalId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        description: dto.description,
        city: dto.city,
        address: dto.address,
        budget:
          dto.budget !== undefined ? new Prisma.Decimal(dto.budget) : null,
        preferredDate: dto.preferredDate ? new Date(dto.preferredDate) : null,
        attachments: dto.attachments ?? [],
      },
      include: { vertical: { select: { name: true, slug: true } } },
    });

    // Acknowledge the request straight away — best-effort, never blocks it.
    try {
      await this.mail.sendBookingReceived(booking.email, {
        ref: booking.ref,
        name: booking.name,
        service: booking.vertical?.name ?? null,
      });
    } catch (e) {
      this.logger.warn(
        `Booking ack email for ${booking.ref} failed: ${(e as Error).message}`,
      );
    }

    return this.present(booking);
  }

  async mine(userId: string) {
    const rows = await this.prisma.booking.findMany({
      where: { customerId: userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((b) => this.present(b));
  }

  async byRef(ref: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { ref } });
    if (!booking || booking.customerId !== userId) {
      throw new NotFoundException('Booking not found');
    }
    return this.present(booking);
  }

  // ── Admin lifecycle ───────────────────────────────────────────────────

  async list(status?: BookingStatus) {
    const rows = await this.prisma.booking.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((b) => this.present(b));
  }

  async adminByRef(ref: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { ref },
      include: { vertical: { select: { name: true, slug: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return this.present(booking);
  }

  accept(ref: string, dto: AcceptBookingDto, adminId: string, ip?: string) {
    return this.transition(ref, BookingStatus.CONFIRMED, adminId, ip, {
      quotedAmount:
        dto.quotedAmount !== undefined
          ? new Prisma.Decimal(dto.quotedAmount)
          : undefined,
      adminNote: dto.note,
      confirmedAt: new Date(),
    });
  }

  start(ref: string, adminId: string, ip?: string) {
    return this.transition(ref, BookingStatus.IN_PROGRESS, adminId, ip);
  }

  complete(ref: string, adminId: string, ip?: string) {
    return this.transition(ref, BookingStatus.COMPLETED, adminId, ip, {
      completedAt: new Date(),
    });
  }

  reject(ref: string, dto: CancelBookingDto, adminId: string, ip?: string) {
    return this.transition(ref, BookingStatus.CANCELLED, adminId, ip, {
      cancelReason: dto.reason,
      cancelledAt: new Date(),
    });
  }

  cancel(ref: string, dto: CancelBookingDto, adminId: string, ip?: string) {
    return this.transition(ref, BookingStatus.CANCELLED, adminId, ip, {
      cancelReason: dto.reason,
      cancelledAt: new Date(),
    });
  }

  private async transition(
    ref: string,
    to: BookingStatus,
    adminId: string,
    ip?: string,
    extra: Prisma.BookingUpdateInput = {},
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { ref },
      include: { vertical: { select: { name: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (!TRANSITIONS[booking.status].includes(to)) {
      throw new BadRequestException(
        `Cannot move a ${booking.status} booking to ${to}`,
      );
    }

    const updated = await this.prisma.booking.update({
      where: { ref },
      data: { status: to, ...extra },
    });

    await this.audit.record({
      actorId: adminId,
      action: `Booking ${to.toLowerCase()}`,
      targetType: 'Booking',
      targetId: booking.id,
      before: { status: booking.status },
      after: { status: to },
      ip,
    });

    // Keep the requester informed on every admin action — best-effort.
    try {
      await this.mail.sendBookingStatus(updated.email, {
        ref: updated.ref,
        name: updated.name,
        service: booking.vertical?.name ?? null,
        status: to,
        quotedAmount: updated.quotedAmount?.toString() ?? null,
        note: updated.adminNote,
        reason: updated.cancelReason,
      });
    } catch (e) {
      this.logger.warn(
        `Booking status email for ${updated.ref} failed: ${(e as Error).message}`,
      );
    }

    return this.present(updated);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private newRef(): string {
    return `BKG-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private present(
    b: Booking & { vertical?: { name: string; slug: string } | null },
  ) {
    return {
      ref: b.ref,
      status: b.status,
      service: b.vertical?.name ?? null,
      name: b.name,
      email: b.email,
      phone: b.phone,
      description: b.description,
      city: b.city,
      address: b.address,
      budget: b.budget,
      quotedAmount: b.quotedAmount,
      preferredDate: b.preferredDate,
      attachments: b.attachments,
      adminNote: b.adminNote,
      cancelReason: b.cancelReason,
      createdAt: b.createdAt,
      confirmedAt: b.confirmedAt,
      completedAt: b.completedAt,
    };
  }
}
