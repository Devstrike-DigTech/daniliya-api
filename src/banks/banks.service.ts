import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBankAccountDto, ResolveAccountDto } from './dto/banks.dto';
import { PaystackBanksService } from './paystack-banks.service';

@Injectable()
export class BanksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackBanksService,
    private readonly audit: AuditService,
  ) {}

  listBanks() {
    return this.paystack.listBanks();
  }

  /** Name-enquiry. The client never supplies the account name — we resolve it. */
  async resolve(dto: ResolveAccountDto) {
    const bank = await this.findBank(dto.bankCode);
    const resolved = await this.paystack.resolveAccount(dto.accountNumber, dto.bankCode);

    if (!resolved) {
      throw new BadRequestException(
        'We could not verify that account. Check the number and bank.',
      );
    }

    return {
      accountNumber: resolved.accountNumber,
      accountName: resolved.accountName,
      bankCode: dto.bankCode,
      bankName: bank.name,
      stub: this.paystack.isStub || undefined,
    };
  }

  list(userId: string) {
    return this.prisma.bankAccount.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(userId: string, dto: CreateBankAccountDto, ip?: string) {
    const resolved = await this.resolve(dto);

    const existing = await this.prisma.bankAccount.findUnique({
      where: {
        userId_bankCode_accountNumber: {
          userId,
          bankCode: dto.bankCode,
          accountNumber: dto.accountNumber,
        },
      },
    });
    if (existing) {
      throw new BadRequestException('That account is already saved');
    }

    // First account is always the default.
    const count = await this.prisma.bankAccount.count({ where: { userId } });
    const makeDefault = dto.isDefault || count === 0;

    const account = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.bankAccount.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.bankAccount.create({
        data: {
          userId,
          bankCode: dto.bankCode,
          bankName: resolved.bankName,
          accountNumber: dto.accountNumber,
          accountName: resolved.accountName,
          isDefault: makeDefault,
          // Verified because the name came from name-enquiry, not the client.
          verified: !this.paystack.isStub,
        },
      });
    });

    await this.audit.record({
      actorId: userId,
      action: 'Added payout account',
      targetType: 'BankAccount',
      targetId: account.id,
      after: { bankName: account.bankName, accountNumber: account.accountNumber },
      ip,
    });

    return account;
  }

  async setDefault(userId: string, id: string, ip?: string) {
    const account = await this.ownedOrThrow(userId, id);

    await this.prisma.$transaction([
      this.prisma.bankAccount.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.bankAccount.update({ where: { id }, data: { isDefault: true } }),
    ]);

    await this.audit.record({
      actorId: userId,
      action: 'Changed default payout account',
      targetType: 'BankAccount',
      targetId: id,
      after: { bankName: account.bankName, accountNumber: account.accountNumber },
      ip,
    });

    return this.prisma.bankAccount.findUnique({ where: { id } });
  }

  async remove(userId: string, id: string, ip?: string) {
    const account = await this.ownedOrThrow(userId, id);

    await this.prisma.bankAccount.delete({ where: { id } });

    await this.audit.record({
      actorId: userId,
      action: 'Removed payout account',
      targetType: 'BankAccount',
      targetId: id,
      before: { bankName: account.bankName, accountNumber: account.accountNumber },
      ip,
    });

    return { message: 'Payout account removed.' };
  }

  private async ownedOrThrow(userId: string, id: string) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!account || account.userId !== userId) {
      throw new NotFoundException('Bank account not found');
    }
    return account;
  }

  private async findBank(code: string) {
    const banks = await this.paystack.listBanks();
    const bank = banks.find((b) => b.code === code);
    if (!bank) throw new BadRequestException('Unknown bank code');
    return bank;
  }
}
