import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PRICING } from './pricing';

/** Config keys and their built-in defaults (naira / percent / bps as strings). */
const DEFAULTS: Record<string, string> = {
  DELIVERY_FEE: PRICING.DELIVERY_FEE.toString(),
  TAX: PRICING.TAX.toString(),
  GIFT_ADDON: PRICING.GIFT_ADDON.toString(),
  AFFILIATE_COMMISSION: PRICING.AFFILIATE_COMMISSION.toString(),
  VENDOR_TAKE_RATE_PCT: PRICING.VENDOR_TAKE_RATE_PCT.toString(),
  MIN_PAYOUT: PRICING.MIN_PAYOUT.toString(),
};

/**
 * Finance-tunable platform settings. Seeds defaults on boot, caches in memory
 * so money math stays synchronous, and refreshes the cache on update.
 */
@Injectable()
export class PlatformConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformConfigService.name);
  private readonly cache = new Map<string, string>(Object.entries(DEFAULTS));

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    // Seed any missing keys, then load all persisted values into the cache.
    for (const [key, value] of Object.entries(DEFAULTS)) {
      await this.prisma.platformConfig.upsert({
        where: { key },
        create: { key, value },
        update: {},
      });
    }
    const rows = await this.prisma.platformConfig.findMany();
    for (const r of rows) this.cache.set(r.key, r.value);
    this.logger.log(`Loaded ${rows.length} platform config keys`);
  }

  getDecimal(key: keyof typeof DEFAULTS): Prisma.Decimal {
    return new Prisma.Decimal(this.cache.get(key) ?? DEFAULTS[key]);
  }

  all() {
    return Object.keys(DEFAULTS).map((key) => ({
      key,
      value: this.cache.get(key) ?? DEFAULTS[key],
    }));
  }

  async update(updates: Record<string, string>) {
    const applied: { key: string; value: string }[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (!(key in DEFAULTS)) continue; // ignore unknown keys
      // Reject non-numeric — every config value here is a money/rate figure.
      try {
        new Prisma.Decimal(value);
      } catch {
        continue;
      }
      await this.prisma.platformConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
      this.cache.set(key, value);
      applied.push({ key, value });
    }
    return applied;
  }
}
