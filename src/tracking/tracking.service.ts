import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Click tracking for influencer (and affiliate) share links.
 *
 * A share link points at GET /track/:code. Each hit records a timestamped
 * ClickEvent and bumps the per-assignment counter, then the visitor is
 * redirected to the storefront with the code applied for purchase attribution.
 * The counters are what make the dashboards' click + conversion-rate metrics
 * real rather than always-zero.
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Where the storefront lives — clicks land here with the ref applied. */
  private webBase(): string {
    return (
      this.config.get<string>('WEB_APP_URL')?.replace(/\/$/, '') ??
      'http://localhost:3000'
    );
  }

  /**
   * Record a click for `code` and return the storefront URL to redirect to.
   * Unknown codes still redirect (to the shop) but record nothing — a bad link
   * shouldn't 404 a shopper, and we don't want to log noise for codes we can't
   * attribute.
   */
  async recordAndResolve(
    code: string,
    opts: { productSlug?: string; userAgent?: string },
  ): Promise<string> {
    const base = this.webBase();
    const dest = opts.productSlug
      ? `${base}/shop/${encodeURIComponent(opts.productSlug)}`
      : `${base}/shop`;
    const url = `${dest}?ref=${encodeURIComponent(code)}`;

    try {
      // Affiliate referral code? Log the click against the affiliate.
      const affiliate = await this.prisma.affiliateProfile.findUnique({
        where: { referralCode: code },
        select: { id: true },
      });
      if (affiliate) {
        await this.prisma.clickEvent.create({
          data: {
            affiliateCode: code,
            userAgent: opts.userAgent?.slice(0, 300) ?? null,
          },
        });
        return url;
      }

      // Otherwise an influencer campaign promo code.
      const assignment = await this.prisma.campaignInfluencerAssignment.findFirst(
        {
          where: { promoCode: code },
          include: { influencer: { select: { influencerCode: true } } },
        },
      );
      if (!assignment) return url;

      await this.prisma.$transaction([
        this.prisma.campaignInfluencerAssignment.update({
          where: { id: assignment.id },
          data: { clicks: { increment: 1 } },
        }),
        this.prisma.clickEvent.create({
          data: {
            influencerCode: assignment.influencer.influencerCode,
            campaignId: assignment.campaignId,
            userAgent: opts.userAgent?.slice(0, 300) ?? null,
          },
        }),
      ]);
    } catch (err) {
      // Never let a tracking failure block the redirect.
      this.logger.error(
        `Failed to record click for ${code}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    return url;
  }
}
