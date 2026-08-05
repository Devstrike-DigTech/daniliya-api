import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignStatus,
  PayoutModel,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignInfluencersDto,
  CreateCampaignDto,
  ReviewSubmissionDto,
  SubmitPostDto,
} from './dto/campaign.dto';

const DOMAIN = 'https://daniliya.com';

const DAY = 86_400_000;
const ACTIVE_EARNING = ['PENDING', 'CONFIRMED', 'QUEUED'];

/** Short weekday name in Lagos time, e.g. "Mon". */
const weekdayLabel = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Africa/Lagos' });

/** Period-over-period % change, 1dp. No prior → +100% when there's activity now, else 0. */
function pctChange(
  current: Prisma.Decimal | number,
  previous: Prisma.Decimal | number,
): number {
  const cur = new Prisma.Decimal(current);
  const prev = new Prisma.Decimal(previous);
  if (prev.isZero()) return cur.isZero() ? 0 : 100;
  return Number(cur.minus(prev).dividedBy(prev).times(100).toFixed(1));
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Admin ─────────────────────────────────────────────────────────────

  async create(dto: CreateCampaignDto, adminId: string, ip?: string) {
    if (dto.payoutModel === PayoutModel.FLAT && dto.flatAmount === undefined) {
      throw new BadRequestException(
        'flatAmount is required for a FLAT (CPA) campaign',
      );
    }
    if (
      dto.payoutModel === PayoutModel.COMMISSION &&
      dto.commissionRate === undefined
    ) {
      throw new BadRequestException(
        'commissionRate is required for a COMMISSION campaign',
      );
    }

    const campaign = await this.prisma.campaign.create({
      data: {
        title: dto.title,
        brief: dto.brief,
        productIds: dto.productIds ?? [],
        payoutModel: dto.payoutModel,
        commissionRate:
          dto.commissionRate !== undefined
            ? new Prisma.Decimal(dto.commissionRate)
            : null,
        flatAmount:
          dto.flatAmount !== undefined
            ? new Prisma.Decimal(dto.flatAmount)
            : null,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });

    await this.audit.record({
      actorId: adminId,
      action: 'Created campaign',
      targetType: 'Campaign',
      targetId: campaign.id,
      after: { title: campaign.title, payoutModel: campaign.payoutModel },
      ip,
    });
    return campaign;
  }

  async list() {
    return this.prisma.campaign.findMany({
      include: { _count: { select: { assignments: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        assignments: {
          include: {
            influencer: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
            submissions: true,
          },
        },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  setStatus(id: string, status: CampaignStatus, adminId: string, ip?: string) {
    return this.transition(id, status, adminId, ip);
  }

  private async transition(
    id: string,
    to: CampaignStatus,
    adminId: string,
    ip?: string,
  ) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status === CampaignStatus.ENDED) {
      throw new BadRequestException('This campaign has ended');
    }
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: to },
    });
    await this.audit.record({
      actorId: adminId,
      action: `Campaign ${to.toLowerCase()}`,
      targetType: 'Campaign',
      targetId: id,
      before: { status: campaign.status },
      after: { status: to },
      ip,
    });
    return updated;
  }

  /** Assign influencers — each gets a unique promo code + UTM link. */
  async assign(
    campaignId: string,
    dto: AssignInfluencersDto,
    adminId: string,
    ip?: string,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const results: {
      influencerId: string;
      promoCode: string | null;
      utmLink?: string;
      already?: boolean;
    }[] = [];
    for (const userId of dto.influencerUserIds) {
      const influencer = await this.prisma.influencerProfile.findUnique({
        where: { userId },
      });
      if (!influencer || !influencer.isApproved) continue;

      const existing =
        await this.prisma.campaignInfluencerAssignment.findUnique({
          where: {
            campaignId_influencerId: {
              campaignId,
              influencerId: influencer.id,
            },
          },
        });
      if (existing) {
        results.push({
          influencerId: influencer.id,
          promoCode: existing.promoCode,
          already: true,
        });
        continue;
      }

      const promoCode = await this.uniquePromo();
      const utmLink = `${DOMAIN}/shop?utm_source=creator&utm_campaign=${campaignId.slice(0, 8)}&ref=${influencer.influencerCode}`;

      await this.prisma.$transaction([
        this.prisma.campaignInfluencerAssignment.create({
          data: { campaignId, influencerId: influencer.id, promoCode, utmLink },
        }),
        this.prisma.promoCode.create({
          data: { code: promoCode, campaignId, influencerId: influencer.id },
        }),
      ]);

      results.push({ influencerId: influencer.id, promoCode, utmLink });
    }

    await this.audit.record({
      actorId: adminId,
      action: 'Assigned influencers to campaign',
      targetType: 'Campaign',
      targetId: campaignId,
      after: { count: results.length },
      ip,
    });
    return { assigned: results };
  }

  async submissions(campaignId: string) {
    return this.prisma.campaignSubmission.findMany({
      where: { assignment: { campaignId } },
      include: {
        assignment: {
          include: {
            influencer: { include: { user: { select: { firstName: true } } } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async reviewSubmission(
    submissionId: string,
    decision: SubmissionStatus,
    dto: ReviewSubmissionDto,
    adminId: string,
    ip?: string,
  ) {
    const submission = await this.prisma.campaignSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    const updated = await this.prisma.campaignSubmission.update({
      where: { id: submissionId },
      data: {
        status: decision,
        reviewerNote: dto.note,
        reviewedAt: new Date(),
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: `Submission ${decision.toLowerCase()}`,
      targetType: 'CampaignSubmission',
      targetId: submissionId,
      before: { status: submission.status },
      after: { status: decision },
      ip,
    });
    return updated;
  }

  // ── Influencer ────────────────────────────────────────────────────────

  async myCampaigns(userId: string) {
    const influencer = await this.influencerOrThrow(userId);
    const assignments = await this.prisma.campaignInfluencerAssignment.findMany(
      {
        where: { influencerId: influencer.id },
        include: { campaign: true, submissions: true },
        orderBy: { assignedAt: 'desc' },
      },
    );

    // A brand-ish label per campaign, derived from its first product.
    const productIds = [
      ...new Set(assignments.flatMap((a) => a.campaign.productIds)),
    ];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, title: true, category: true, slug: true },
        })
      : [];
    const byProduct = new Map(products.map((p) => [p.id, p]));
    const brandOf = (ids: string[]) => {
      const p = ids.map((id) => byProduct.get(id)).find(Boolean);
      return p?.category ?? p?.title ?? 'Daniliya';
    };
    const slugOf = (ids: string[]) => {
      const p = ids.map((id) => byProduct.get(id)).find(Boolean);
      return p?.slug ?? null;
    };

    return assignments.map((a) => ({
      campaignId: a.campaignId,
      title: a.campaign.title,
      brand: brandOf(a.campaign.productIds),
      productSlug: slugOf(a.campaign.productIds),
      brief: a.campaign.brief,
      status: a.campaign.status,
      startDate: a.campaign.startDate,
      endDate: a.campaign.endDate,
      payoutModel: a.campaign.payoutModel,
      cpa: a.campaign.flatAmount,
      commissionRate: a.campaign.commissionRate,
      promoCode: a.promoCode,
      utmLink: a.utmLink,
      accepted: a.accepted,
      clicks: a.clicks,
      conversions: a.conversions,
      /** Per-campaign earned: conversions × CPA (flat campaigns). */
      earned: a.campaign.flatAmount
        ? a.campaign.flatAmount.times(a.conversions)
        : new Prisma.Decimal(0),
      submissions: a.submissions.map((s) => ({
        postUrl: s.postUrl,
        status: s.status,
      })),
    }));
  }

  async accept(userId: string, campaignId: string) {
    const assignment = await this.myAssignment(userId, campaignId, true);
    await this.prisma.campaignInfluencerAssignment.update({
      where: { id: assignment.id },
      data: { accepted: true },
    });
    return { campaignId, accepted: true };
  }

  async submitPost(userId: string, campaignId: string, dto: SubmitPostDto) {
    const assignment = await this.myAssignment(userId, campaignId, true);
    if (!assignment.accepted) {
      throw new BadRequestException(
        'Accept the campaign brief before submitting a post',
      );
    }
    const submission = await this.prisma.campaignSubmission.create({
      data: {
        assignmentId: assignment.id,
        postUrl: dto.postUrl,
        hasAdDisclosure: dto.hasAdDisclosure ?? false,
      },
    });
    return { id: submission.id, status: submission.status };
  }

  async myEarnings(userId: string) {
    const rows = await this.prisma.commissionRecord.findMany({
      where: { beneficiaryId: userId, beneficiaryType: 'INFLUENCER' },
      orderBy: { createdAt: 'desc' },
    });
    const sum = (statuses: string[]) =>
      rows
        .filter((r) => statuses.includes(r.status))
        .reduce((acc, r) => acc.plus(r.amount), new Prisma.Decimal(0));

    return {
      summary: {
        pending: sum(['PENDING', 'CONFIRMED', 'QUEUED']),
        disbursed: sum(['DISBURSED']),
        conversions: rows.filter((r) => r.status !== 'VOIDED').length,
      },
      records: rows.map((r) => ({
        amount: r.amount,
        status: r.status,
        at: r.createdAt,
      })),
    };
  }

  /**
   * Dashboard rollup for the influencer Overview — all real, derived from
   * assignments (clicks/conversions), commission records (earnings) and click
   * events (weekly clicks). Per-campaign "earned" is conversions × CPA for flat
   * campaigns; commission campaigns carry no per-campaign total so read 0 there.
   */
  async overview(userId: string) {
    const influencer = await this.influencerOrThrow(userId);
    const now = new Date();
    const start7 = new Date(now.getTime() - 7 * DAY);
    const start14 = new Date(now.getTime() - 14 * DAY);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    const [assignments, earnings, clicks14] = await Promise.all([
      this.prisma.campaignInfluencerAssignment.findMany({
        where: { influencerId: influencer.id },
        include: { campaign: true },
        orderBy: { assignedAt: 'desc' },
      }),
      this.prisma.commissionRecord.findMany({
        where: {
          beneficiaryId: userId,
          beneficiaryType: 'INFLUENCER',
          status: { not: 'VOIDED' },
        },
        select: { amount: true, status: true, createdAt: true },
      }),
      this.prisma.clickEvent.findMany({
        where: {
          influencerCode: influencer.influencerCode,
          timestamp: { gte: start14 },
        },
        select: { timestamp: true },
      }),
    ]);

    const zero = new Prisma.Decimal(0);
    const sumAmt = (rows: { amount: Prisma.Decimal }[]) =>
      rows.reduce((a, r) => a.plus(r.amount), zero);

    const totalEarnings = sumAmt(earnings);
    const pending = sumAmt(earnings.filter((r) => ACTIVE_EARNING.includes(r.status)));
    const thisMonth = sumAmt(earnings.filter((r) => r.createdAt >= monthStart));
    const prevMonth = sumAmt(
      earnings.filter((r) => r.createdAt >= prevMonthStart && r.createdAt < monthStart),
    );

    // Weekly earnings series (last 7 days, chronological).
    const series = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getTime() - (6 - i) * DAY);
      return { key: d.toISOString().slice(0, 10), label: weekdayLabel(d), amount: zero };
    });
    for (const r of earnings) {
      if (r.createdAt >= start7) {
        const key = r.createdAt.toISOString().slice(0, 10);
        const b = series.find((s) => s.key === key);
        if (b) b.amount = b.amount.plus(r.amount);
      }
    }

    const clicksThisWeek = clicks14.filter((c) => c.timestamp >= start7).length;
    const clicksPrev = clicks14.length - clicksThisWeek;

    const totalClicks = assignments.reduce((n, a) => n + a.clicks, 0);
    const conversions = assignments.reduce((n, a) => n + a.conversions, 0);
    const conversionRate =
      totalClicks > 0 ? Number(((conversions / totalClicks) * 100).toFixed(1)) : 0;

    // Product → a brand-ish label for the campaign card.
    const productIds = [
      ...new Set(assignments.flatMap((a) => a.campaign.productIds)),
    ];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, title: true, category: true },
        })
      : [];
    const byProduct = new Map(products.map((p) => [p.id, p]));
    const brandOf = (ids: string[]) => {
      const p = ids.map((id) => byProduct.get(id)).find(Boolean);
      return p?.category ?? p?.title ?? 'Daniliya';
    };

    const shape = (a: (typeof assignments)[number]) => ({
      campaignId: a.campaignId,
      title: a.campaign.title,
      brand: brandOf(a.campaign.productIds),
      cpa: a.campaign.flatAmount,
      clicks: a.clicks,
      conversions: a.conversions,
      earned: a.campaign.flatAmount
        ? a.campaign.flatAmount.times(a.conversions)
        : zero,
    });

    return {
      totalEarnings,
      earningsMomPct: pctChange(thisMonth, prevMonth),
      pending,
      conversions,
      conversionRate,
      clicksThisWeek,
      clicksDeltaPct: pctChange(clicksThisWeek, clicksPrev),
      weekly: series.map((s) => ({ label: s.label, amount: s.amount })),
      active: assignments
        .filter((a) => a.campaign.status === CampaignStatus.ACTIVE)
        .map(shape),
      ended: assignments
        .filter((a) => a.campaign.status === CampaignStatus.ENDED)
        .map(shape),
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async influencerOrThrow(userId: string) {
    const influencer = await this.prisma.influencerProfile.findUnique({
      where: { userId },
    });
    if (!influencer) throw new ForbiddenException('Not an influencer');
    return influencer;
  }

  /**
   * The creator's assignment on a campaign.
   *
   * `requireLive` guards the write paths: a paused or ended campaign must not
   * take a new acceptance or post submission. Enforced here rather than in each
   * caller so accept() and submitPost() cannot drift apart, and because a portal
   * -side check is trivially bypassed by calling the API directly.
   */
  private async myAssignment(
    userId: string,
    campaignId: string,
    requireLive = false,
  ) {
    const influencer = await this.influencerOrThrow(userId);
    const assignment =
      await this.prisma.campaignInfluencerAssignment.findUnique({
        where: {
          campaignId_influencerId: { campaignId, influencerId: influencer.id },
        },
        include: { campaign: { select: { status: true } } },
      });
    if (!assignment)
      throw new NotFoundException('You are not assigned to this campaign');

    if (requireLive && assignment.campaign.status !== CampaignStatus.ACTIVE) {
      throw new BadRequestException(
        assignment.campaign.status === CampaignStatus.PAUSED
          ? 'This campaign is paused'
          : 'This campaign has ended',
      );
    }
    return assignment;
  }

  private async uniquePromo(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = `DAN-${randomBytes(3).toString('hex').toUpperCase()}`;
      const taken = await this.prisma.promoCode.findUnique({ where: { code } });
      if (!taken) return code;
    }
    throw new Error('Could not allocate a unique promo code');
  }
}
