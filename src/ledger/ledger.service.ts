import { BadRequestException, Injectable } from '@nestjs/common';
import { LedgerType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Append-only double-entry ledger. Every wallet balance change goes through
 * credit()/debit(); Wallet.balance is a cache derived from LedgerEntry rows.
 * Balances never go negative. See docs/04-business-rules.md §7.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async credit(
    userId: string,
    amount: Prisma.Decimal,
    source: string,
    sourceId: string | undefined,
    db: Db = this.prisma,
  ) {
    const wallet = await db.wallet.upsert({
      where: { userId },
      create: { userId, balance: amount },
      update: { balance: { increment: amount } },
    });
    await db.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: LedgerType.CREDIT,
        amount,
        source,
        sourceId,
        balanceAfter: wallet.balance,
      },
    });
    return wallet.balance;
  }

  async debit(
    userId: string,
    amount: Prisma.Decimal,
    source: string,
    sourceId: string | undefined,
    db: Db = this.prisma,
  ) {
    const wallet = await db.wallet.findUnique({ where: { userId } });
    if (!wallet || wallet.balance.lessThan(amount)) {
      throw new BadRequestException('Insufficient wallet balance');
    }
    const updated = await db.wallet.update({
      where: { userId },
      data: { balance: { decrement: amount } },
    });
    await db.ledgerEntry.create({
      data: {
        walletId: updated.id,
        type: LedgerType.DEBIT,
        amount,
        source,
        sourceId,
        balanceAfter: updated.balance,
      },
    });
    return updated.balance;
  }

  async balance(userId: string): Promise<Prisma.Decimal> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return wallet?.balance ?? new Prisma.Decimal(0);
  }

  /**
   * Drift check: Σcredits − Σdebits across all ledger entries must equal the
   * sum of cached wallet balances. Any non-zero drift is a bug.
   */
  async reconcile() {
    const [credits, debits, wallets] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: { type: LedgerType.CREDIT },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { type: LedgerType.DEBIT },
        _sum: { amount: true },
      }),
      this.prisma.wallet.aggregate({ _sum: { balance: true } }),
    ]);
    const ledgerNet = (credits._sum.amount ?? new Prisma.Decimal(0)).minus(
      debits._sum.amount ?? 0,
    );
    const walletTotal = wallets._sum.balance ?? new Prisma.Decimal(0);
    const drift = ledgerNet.minus(walletTotal);
    return {
      ledgerNet,
      walletTotal,
      drift,
      balanced: drift.isZero(),
    };
  }
}
