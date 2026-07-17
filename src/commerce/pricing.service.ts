import { Injectable } from '@nestjs/common';
import { FulfilmentMode, Prisma } from '@prisma/client';
import { PRICING } from '../config/pricing';

export interface PriceableLine {
  unitPrice: Prisma.Decimal;
  quantity: number;
  giftWrap: boolean;
}

export interface PriceBreakdown {
  subtotal: Prisma.Decimal;
  giftAddon: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * The one place order money is computed. Server-side only — client totals are
 * never trusted. See docs/04-business-rules.md §2.
 */
@Injectable()
export class PricingService {
  quote(lines: PriceableLine[], mode: FulfilmentMode): PriceBreakdown {
    const zero = new Prisma.Decimal(0);

    const subtotal = lines.reduce(
      (sum, l) => sum.plus(l.unitPrice.times(l.quantity)),
      zero,
    );

    const giftedUnits = lines
      .filter((l) => l.giftWrap)
      .reduce((n, l) => n + l.quantity, 0);
    const giftAddon = PRICING.GIFT_ADDON.times(giftedUnits);

    // Pickup pays no delivery fee. Tax applies to every order.
    const deliveryFee =
      mode === FulfilmentMode.DELIVERY ? PRICING.DELIVERY_FEE : new Prisma.Decimal(0);
    const tax = PRICING.TAX;

    const total = subtotal.plus(giftAddon).plus(deliveryFee).plus(tax);

    return { subtotal, giftAddon, deliveryFee, tax, total };
  }
}
