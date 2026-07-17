import { Prisma } from '@prisma/client';

const naira = (n: string) => new Prisma.Decimal(n);

/**
 * Platform pricing — the single source of truth for checkout math.
 * Values mirror the live frontends (daniliya-web CheckoutFlow / ProductBuyBox).
 *
 * Phase 7 moves these into a finance-tunable `PlatformConfig` table; until then
 * a change here is a deploy. See docs/04-business-rules.md §1.
 */
export const PRICING = {
  /** Flat delivery fee. Pickup orders pay nothing. */
  DELIVERY_FEE: naira('8500.00'),
  /** Flat tax applied to every order. */
  TAX: naira('2500.00'),
  /** Signature gift packaging, charged per gift-wrapped item. */
  GIFT_ADDON: naira('1500.00'),
  /** Flat affiliate commission per confirmed sale — not a percentage. */
  AFFILIATE_COMMISSION: naira('10000.00'),
  /** Platform take-rate on vendor sales, as a percentage. */
  VENDOR_TAKE_RATE_PCT: naira('10'),
  /** Below this, payouts roll over to the next week. */
  MIN_PAYOUT: naira('5000.00'),
} as const;
