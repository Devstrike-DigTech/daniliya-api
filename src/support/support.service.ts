import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupportTicket, TicketMessage, TicketStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { OpenTicketDto, TicketReplyDto } from '../admin/dto/admin.dto';

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── User ──────────────────────────────────────────────────────────────

  async open(userId: string, dto: OpenTicketDto) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        ref: `TCK-${randomBytes(2).toString('hex').toUpperCase()}`,
        openedById: userId,
        subject: dto.subject,
        priority: dto.priority ?? 'NORMAL',
        messages: {
          create: { authorId: userId, fromAdmin: false, body: dto.body },
        },
      },
    });
    return this.present(ticket);
  }

  async mine(userId: string) {
    const rows = await this.prisma.supportTicket.findMany({
      where: { openedById: userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((t) => this.present(t));
  }

  async myTicket(userId: string, ref: string) {
    const ticket = await this.loadWithMessages(ref);
    if (ticket.openedById !== userId)
      throw new NotFoundException('Ticket not found');
    return this.presentWithThread(ticket);
  }

  async userReply(userId: string, ref: string, dto: TicketReplyDto) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { ref },
    });
    if (!ticket || ticket.openedById !== userId)
      throw new NotFoundException('Ticket not found');
    return this.addMessage(
      ticket.id,
      userId,
      false,
      dto.body,
      TicketStatus.OPEN,
    );
  }

  // ── Admin ─────────────────────────────────────────────────────────────

  async list(status?: TicketStatus) {
    const rows = await this.prisma.supportTicket.findMany({
      where: status ? { status } : undefined,
      include: { openedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((t) => ({
      ...this.present(t),
      from: `${t.openedBy.firstName} ${t.openedBy.lastName}`,
    }));
  }

  async detail(ref: string) {
    return this.presentWithThread(await this.loadWithMessages(ref));
  }

  async adminReply(adminId: string, ref: string, dto: TicketReplyDto) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { ref },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return this.addMessage(
      ticket.id,
      adminId,
      true,
      dto.body,
      TicketStatus.PENDING,
    );
  }

  async assign(adminId: string, ref: string, ip?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { ref },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const updated = await this.prisma.supportTicket.update({
      where: { ref },
      data: { assignedToId: adminId },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'Assigned support ticket',
      targetType: 'SupportTicket',
      targetId: ticket.id,
      ip,
    });
    return this.present(updated);
  }

  async close(adminId: string, ref: string, ip?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { ref },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const updated = await this.prisma.supportTicket.update({
      where: { ref },
      data: { status: TicketStatus.CLOSED },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'Closed support ticket',
      targetType: 'SupportTicket',
      targetId: ticket.id,
      ip,
    });
    return this.present(updated);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async addMessage(
    ticketId: string,
    authorId: string,
    fromAdmin: boolean,
    body: string,
    status: TicketStatus,
  ) {
    const [message] = await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: { ticketId, authorId, fromAdmin, body },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status },
      }),
    ]);
    return {
      id: message.id,
      fromAdmin,
      body: message.body,
      at: message.createdAt,
    };
  }

  private async loadWithMessages(ref: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { ref },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  private present(t: SupportTicket) {
    return {
      ref: t.ref,
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      updatedAt: t.updatedAt,
    };
  }

  private presentWithThread(t: SupportTicket & { messages: TicketMessage[] }) {
    return {
      ...this.present(t),
      messages: t.messages.map((m) => ({
        fromAdmin: m.fromAdmin,
        body: m.body,
        at: m.createdAt,
      })),
    };
  }
}
