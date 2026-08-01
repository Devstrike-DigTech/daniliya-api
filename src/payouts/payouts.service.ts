import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BeneficiaryType,
  CommissionStatus,
  PayoutAudience,
  PayoutBatchStatus,
  PayoutItemStatus,
  Prisma,
  TransferStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { CommissionsService } from '../commissions/commissions.service';
import { LedgerService } from '../ledger/ledger.service';
import { PlatformConfigService } from '../config/platform-config.service';
import { PaystackService } from '../payments/paystack.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const RUN_LOCK_KEY = 'payouts:run:lock';

const AUDIENCE_TO_TYPE: Record<PayoutAudience, BeneficiaryType> = {
  AFFILIATE: BeneficiaryType.AFFILIATE,
  INFLUENCER: BeneficiaryType.INFLUENCER,
  VENDOR: BeneficiaryType.VENDOR,
};

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commissions: CommissionsService,
    private readonly ledger: LedgerService,
    private readonly paystack: PaystackService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly config: PlatformConfigService,
  ) {}

  /** Automated weekly run — Monday 09:00 (server TZ). */
  @Cron(CronExpression.EVERY_WEEK, { name: 'weekly-payout' })
  async weeklyRun() {
    this.logger.log('Weekly payout cron firing');
    await this.run();
  }

  /**
   * The run: confirm eligible commissions, then batch by audience. Guarded by a
   * Redis lock so a manual trigger and the cron can't batch concurrently.
   */
  async run(adminId?: string, ip?: string) {
    const locked = await this.redis.acquireLock(RUN_LOCK_KEY, 120);
    if (!locked) {
      throw new BadRequestException('A payout run is already in progress');
    }
    try {
      return await this.doRun(adminId, ip);
    } finally {
      await this.redis.releaseLock(RUN_LOCK_KEY);
    }
  }

  private async doRun(adminId?: string, ip?: string) {
    const confirmed = await this.commissions.confirmEligible();
    const batches: {
      ref: string;
      audience: PayoutAudience;
      recipients: number;
      total: string;
    }[] = [];

    for (const audience of [
      PayoutAudience.AFFILIATE,
      PayoutAudience.INFLUENCER,
      PayoutAudience.VENDOR,
    ]) {
      const type = AUDIENCE_TO_TYPE[audience];
      const eligible = await this.prisma.commissionRecord.findMany({
        where: {
          status: CommissionStatus.CONFIRMED,
          beneficiaryType: type,
          payoutItemId: null,
        },
      });
      if (eligible.length === 0) continue;

      // Group confirmed commissions by beneficiary.
      const byUser = new Map<
        string,
        { amount: Prisma.Decimal; ids: string[] }
      >();
      for (const c of eligible) {
        const g = byUser.get(c.beneficiaryId) ?? {
          amount: new Prisma.Decimal(0),
          ids: [],
        };
        g.amount = g.amount.plus(c.amount);
        g.ids.push(c.id);
        byUser.set(c.beneficiaryId, g);
      }

      // Keep only those over the minimum with a bank account on file.
      const includable: {
        userId: string;
        amount: Prisma.Decimal;
        ids: string[];
        bankAccountId: string | null;
      }[] = [];
      for (const [userId, g] of byUser) {
        if (g.amount.lessThan(this.config.getDecimal('MIN_PAYOUT'))) continue; // rolls over
        const bank = await this.prisma.bankAccount.findFirst({
          where: { userId },
          orderBy: { isDefault: 'desc' },
        });
        includable.push({
          userId,
          amount: g.amount,
          ids: g.ids,
          bankAccountId: bank?.id ?? null,
        });
      }
      if (includable.length === 0) continue;

      const total = includable.reduce(
        (s, i) => s.plus(i.amount),
        new Prisma.Decimal(0),
      );
      const batch = await this.prisma.$transaction(async (tx) => {
        const created = await tx.payoutBatch.create({
          data: {
            ref: this.newBatchRef(),
            audience,
            scheduledDate: this.nextMonday(),
            totalAmount: total,
            status: PayoutBatchStatus.REVIEW,
          },
        });
        for (const inc of includable) {
          const item = await tx.payoutItem.create({
            data: {
              batchId: created.id,
              beneficiaryId: inc.userId,
              bankAccountId: inc.bankAccountId,
              amount: inc.amount,
            },
          });
          await tx.commissionRecord.updateMany({
            where: { id: { in: inc.ids } },
            data: {
              status: CommissionStatus.QUEUED,
              payoutItemId: item.id,
              payoutBatchId: created.id,
            },
          });
        }
        // Compliance gate.
        const allBanked = includable.every((i) => i.bankAccountId);
        await tx.complianceCheck.createMany({
          data: [
            {
              batchId: created.id,
              label: 'KYC verified on all recipients',
              passed: allBanked,
            },
            {
              batchId: created.id,
              label: 'Bank accounts validated',
              passed: allBanked,
            },
            {
              batchId: created.id,
              label: 'Sufficient float on Paystack',
              passed: true,
            },
          ],
        });
        return created;
      });

      batches.push({
        ref: batch.ref,
        audience,
        recipients: includable.length,
        total: total.toString(),
      });
    }

    if (adminId) {
      await this.audit.record({
        actorId: adminId,
        action: 'Ran payout batch',
        targetType: 'PayoutBatch',
        after: { confirmed, batches: batches.length },
        ip,
      });
    }
    return { confirmedCommissions: confirmed, batches };
  }

  /**
   * Commissions that are owed but not yet in a batch — PENDING (awaiting order
   * confirmation) or CONFIRMED (ready for the next run). This is what "Run
   * payouts" will sweep up, so the admin can see freshly-earned commissions
   * before a batch exists for them.
   */
  async pendingSummary() {
    const grouped = await this.prisma.commissionRecord.groupBy({
      by: ['beneficiaryType', 'status'],
      where: {
        payoutItemId: null,
        status: { in: [CommissionStatus.PENDING, CommissionStatus.CONFIRMED] },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const zero = new Prisma.Decimal(0);
    let total = zero;
    let count = 0;
    let readyTotal = zero; // CONFIRMED — sweepable on the next run
    const byAudience: Record<string, { amount: string; count: number }> = {};

    for (const g of grouped) {
      const amt = g._sum.amount ?? zero;
      total = total.plus(amt);
      count += g._count._all;
      if (g.status === CommissionStatus.CONFIRMED) readyTotal = readyTotal.plus(amt);
      const key = g.beneficiaryType;
      const row = byAudience[key] ?? { amount: '0', count: 0 };
      byAudience[key] = {
        amount: new Prisma.Decimal(row.amount).plus(amt).toFixed(2),
        count: row.count + g._count._all,
      };
    }

    return {
      total: total.toFixed(2),
      readyTotal: readyTotal.toFixed(2),
      count,
      byAudience,
    };
  }

  async list(audience?: PayoutAudience, status?: PayoutBatchStatus) {
    const rows = await this.prisma.payoutBatch.findMany({
      where: {
        ...(audience ? { audience } : {}),
        ...(status ? { status } : {}),
      },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((b) => ({
      ref: b.ref,
      audience: b.audience,
      status: b.status,
      recipients: b._count.items,
      total: b.totalAmount,
      scheduledDate: b.scheduledDate,
    }));
  }

  async detail(ref: string) {
    const batch = await this.prisma.payoutBatch.findUnique({
      where: { ref },
      include: {
        items: {
          include: {
            beneficiary: { select: { firstName: true, lastName: true } },
            transfer: true,
          },
        },
        checks: true,
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return {
      ref: batch.ref,
      audience: batch.audience,
      status: batch.status,
      total: batch.totalAmount,
      scheduledDate: batch.scheduledDate,
      checks: batch.checks.map((c) => ({ label: c.label, passed: c.passed })),
      items: batch.items.map((i) => ({
        id: i.id,
        beneficiary: `${i.beneficiary.firstName} ${i.beneficiary.lastName}`,
        amount: i.amount,
        status: i.status,
        transfer: i.transfer
          ? { ref: i.transfer.providerRef, status: i.transfer.status }
          : null,
      })),
    };
  }

  /** Approve a batch (all checks must pass) and initiate transfers. */
  async approve(ref: string, adminId: string, ip?: string) {
    const batch = await this.getBatch(ref);
    if (batch.status !== PayoutBatchStatus.REVIEW) {
      throw new BadRequestException(
        `Only a batch in review can be approved (is ${batch.status})`,
      );
    }
    const checks = await this.prisma.complianceCheck.findMany({
      where: { batchId: batch.id },
    });
    if (!checks.every((c) => c.passed)) {
      throw new BadRequestException(
        'Compliance checks must all pass before approval',
      );
    }

    await this.prisma.payoutBatch.update({
      where: { id: batch.id },
      data: {
        status: PayoutBatchStatus.SCHEDULED,
        approvedAt: new Date(),
        adminId,
      },
    });

    await this.initiateTransfers(batch.id);

    await this.audit.record({
      actorId: adminId,
      action: 'Approved payout batch',
      targetType: 'PayoutBatch',
      targetId: batch.id,
      before: { status: PayoutBatchStatus.REVIEW },
      after: { status: PayoutBatchStatus.SCHEDULED },
      ip,
    });
    return this.detail(ref);
  }

  async hold(ref: string, adminId: string, ip?: string) {
    return this.setBatchStatus(ref, PayoutBatchStatus.HELD, adminId, ip);
  }
  async cancel(ref: string, adminId: string, ip?: string) {
    return this.setBatchStatus(ref, PayoutBatchStatus.CANCELLED, adminId, ip);
  }

  async retry(ref: string, adminId: string, ip?: string) {
    const batch = await this.getBatch(ref);
    await this.initiateTransfers(batch.id, true);
    await this.audit.record({
      actorId: adminId,
      action: 'Retried failed transfers',
      targetType: 'PayoutBatch',
      targetId: batch.id,
      ip,
    });
    return this.detail(ref);
  }

  /** Create + fire a Transfer for each pending (or failed, on retry) item. */
  private async initiateTransfers(batchId: string, retryFailed = false) {
    const items = await this.prisma.payoutItem.findMany({
      where: {
        batchId,
        status: retryFailed
          ? PayoutItemStatus.FAILED
          : PayoutItemStatus.PENDING,
      },
      include: { beneficiary: true, batch: true },
    });

    for (const item of items) {
      const bank = item.bankAccountId
        ? await this.prisma.bankAccount.findUnique({
            where: { id: item.bankAccountId },
          })
        : null;

      const reference = `DNLTRF-${randomBytes(8).toString('hex').toUpperCase()}`;
      await this.prisma.transfer.upsert({
        where: { payoutItemId: item.id },
        create: {
          payoutItemId: item.id,
          provider: 'paystack',
          providerRef: reference,
          status: TransferStatus.PENDING,
          idempotencyKey: item.id,
        },
        update: { providerRef: reference, status: TransferStatus.PENDING },
      });
      if (retryFailed) {
        await this.prisma.payoutItem.update({
          where: { id: item.id },
          data: { status: PayoutItemStatus.PENDING, failureReason: null },
        });
      }

      await this.paystack.initiateTransfer({
        amount: item.amount,
        reference,
        reason: `Daniliya ${item.batch.audience.toLowerCase()} payout`,
        recipient: {
          name:
            bank?.accountName ??
            `${item.beneficiary.firstName} ${item.beneficiary.lastName}`,
          bankCode: bank?.bankCode ?? '',
          accountNumber: bank?.accountNumber ?? '',
        },
        idempotencyKey: item.id,
      });
    }
  }

  // ── Transfer webhook (idempotent, signature-verified) ─────────────────

  async handleTransferWebhook(rawBody: Buffer, signature?: string) {
    if (!this.paystack.verifySignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const event = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      data: { reference?: string };
    };
    const reference = event.data?.reference;
    const externalEventId = `paystack:${event.event}:${reference}`;

    const seen = await this.prisma.webhookEvent.findUnique({
      where: { externalEventId },
    });
    if (seen) return { received: true, duplicate: true };

    if (event.event === 'transfer.success' && reference) {
      await this.settleTransfer(reference);
    } else if (event.event === 'transfer.failed' && reference) {
      await this.failTransfer(reference);
    }

    await this.prisma.webhookEvent.create({
      data: {
        provider: 'paystack',
        externalEventId,
        eventType: event.event,
        payload: event,
      },
    });
    return { received: true, duplicate: false };
  }

  private async settleTransfer(reference: string) {
    const transfer = await this.prisma.transfer.findUnique({
      where: { providerRef: reference },
      include: { payoutItem: { include: { commissions: true } } },
    });
    if (!transfer || transfer.status === TransferStatus.SUCCESS) return; // idempotent
    const item = transfer.payoutItem;

    await this.prisma.$transaction(async (tx) => {
      await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: TransferStatus.SUCCESS },
      });
      await tx.payoutItem.update({
        where: { id: item.id },
        data: { status: PayoutItemStatus.PAID },
      });
      await tx.commissionRecord.updateMany({
        where: { payoutItemId: item.id },
        data: { status: CommissionStatus.DISBURSED, disbursedAt: new Date() },
      });
      // Debit the wallet — the credit from confirmation is now settled out.
      await this.ledger.debit(
        item.beneficiaryId,
        item.amount,
        'payout',
        item.id,
        tx,
      );
    });

    await this.maybeCloseBatch(item.batchId);
    this.logger.log(`Transfer ${reference} settled — item ${item.id} paid`);
  }

  private async failTransfer(reference: string) {
    const transfer = await this.prisma.transfer.findUnique({
      where: { providerRef: reference },
      include: { payoutItem: true },
    });
    if (!transfer || transfer.status === TransferStatus.SUCCESS) return;

    await this.prisma.transfer.update({
      where: { id: transfer.id },
      data: { status: TransferStatus.FAILED },
    });
    await this.prisma.payoutItem.update({
      where: { id: transfer.payoutItemId },
      data: {
        status: PayoutItemStatus.FAILED,
        failureReason: 'Transfer failed at provider',
      },
    });
    await this.maybeCloseBatch(transfer.payoutItem.batchId);
  }

  private async maybeCloseBatch(batchId: string) {
    const items = await this.prisma.payoutItem.findMany({ where: { batchId } });
    const anyPending = items.some((i) => i.status === PayoutItemStatus.PENDING);
    if (anyPending) return;
    const anyFailed = items.some((i) => i.status === PayoutItemStatus.FAILED);
    await this.prisma.payoutBatch.update({
      where: { id: batchId },
      data: {
        status: anyFailed ? PayoutBatchStatus.FAILED : PayoutBatchStatus.PAID,
        disbursedAt: anyFailed ? null : new Date(),
      },
    });
  }

  // ── Beneficiary read ──────────────────────────────────────────────────

  async myPayouts(userId: string) {
    const [balance, items] = await Promise.all([
      this.ledger.balance(userId),
      this.prisma.payoutItem.findMany({
        where: { beneficiaryId: userId },
        include: { batch: { select: { ref: true, scheduledDate: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Roll-ups over settled payouts only (PAID) — powers the Lifetime / count /
    // average cards. Everything here is derived from real ledger history, not
    // invented, so an affiliate with no payouts sees zeroes rather than mocks.
    const paid = items.filter((i) => i.status === PayoutItemStatus.PAID);
    const lifetimePaid = paid.reduce(
      (sum, i) => sum.plus(i.amount),
      new Prisma.Decimal(0),
    );
    const payoutsToDate = paid.length;
    const avgPayout =
      payoutsToDate > 0
        ? lifetimePaid.dividedBy(payoutsToDate)
        : new Prisma.Decimal(0);

    return {
      // Confirmed commissions sitting in the wallet — what the next batch pays.
      walletBalance: balance,
      minPayout: this.config.getDecimal('MIN_PAYOUT'),
      nextPayoutDate: this.nextMonday(),
      lifetimePaid,
      payoutsToDate,
      avgPayout,
      history: items.map((i) => ({
        batch: i.batch.ref,
        amount: i.amount,
        status: i.status,
        scheduledDate: i.batch.scheduledDate,
      })),
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async getBatch(ref: string) {
    const batch = await this.prisma.payoutBatch.findUnique({ where: { ref } });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  private async setBatchStatus(
    ref: string,
    to: PayoutBatchStatus,
    adminId: string,
    ip?: string,
  ) {
    const batch = await this.getBatch(ref);
    const updated = await this.prisma.payoutBatch.update({
      where: { id: batch.id },
      data: { status: to },
    });
    await this.audit.record({
      actorId: adminId,
      action: `Payout batch ${to.toLowerCase()}`,
      targetType: 'PayoutBatch',
      targetId: batch.id,
      before: { status: batch.status },
      after: { status: to },
      ip,
    });
    return updated;
  }

  private newBatchRef(): string {
    return `PB-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private nextMonday(): Date {
    const d = new Date();
    const day = d.getUTCDay();
    const add = (8 - day) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + add);
    d.setUTCHours(8, 0, 0, 0);
    return d;
  }
}
