import { Injectable } from '@nestjs/common';
import { FulfilmentMode, Prisma } from '@prisma/client';
import { PlatformConfigService } from '../config/platform-config.service';

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
  constructor(private readonly config: PlatformConfigService) {}

  quote(lines: PriceableLine[], mode: FulfilmentMode): PriceBreakdown {
    const zero = new Prisma.Decimal(0);

    const subtotal = lines.reduce(
      (sum, l) => sum.plus(l.unitPrice.times(l.quantity)),
      zero,
    );

    const giftedUnits = lines
      .filter((l) => l.giftWrap)
      .reduce((n, l) => n + l.quantity, 0);
    const giftAddon = this.config.getDecimal('GIFT_ADDON').times(giftedUnits);

    // Pickup pays no delivery fee. Tax applies to every order.
    const deliveryFee =
      mode === FulfilmentMode.DELIVERY ? this.config.getDecimal('DELIVERY_FEE') : new Prisma.Decimal(0);
    const tax = this.config.getDecimal('TAX');

    const total = subtotal.plus(giftAddon).plus(deliveryFee).plus(tax);

    return { subtotal, giftAddon, deliveryFee, tax, total };
  }
}
