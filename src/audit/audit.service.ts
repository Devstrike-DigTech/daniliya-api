import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  /** Null for automated/system actions. */
  actorId?: string | null;
  /** Verb phrase as it should read in the admin log, e.g. "Approved vendor". */
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Immutable trail of money- and status-affecting writes.
 *
 * Every privileged mutation (approve/reject, suspend, refund, release payout,
 * change tier/role) must call `record()`. Writes are append-only and must never
 * be updated or deleted — corrections are new entries.
 *
 * Audit failures never break the business action: we log loudly instead, since
 * losing a payout because the audit insert failed is worse than a gap we can
 * alert on.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId ?? null,
          before: this.toJson(entry.before),
          after: this.toJson(entry.after),
          ip: entry.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `AUDIT WRITE FAILED — ${entry.action} on ${entry.targetType}:${entry.targetId}`,
        err as Error,
      );
    }
  }

  async list(params: {
    actorId?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    skip?: number;
    take?: number;
  }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(params.actorId && { actorId: params.actorId }),
      ...(params.action && {
        action: { contains: params.action, mode: 'insensitive' },
      }),
      ...(params.targetType && { targetType: params.targetType }),
      ...(params.targetId && { targetId: params.targetId }),
    };

    const take = Math.min(params.take ?? 50, 200);

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take,
        include: {
          actor: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, meta: { total, skip: params.skip ?? 0, take } };
  }

  private toJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
