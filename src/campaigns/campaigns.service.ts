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
    return assignments.map((a) => ({
      campaignId: a.campaignId,
      title: a.campaign.title,
      brief: a.campaign.brief,
      status: a.campaign.status,
      payoutModel: a.campaign.payoutModel,
      cpa: a.campaign.flatAmount,
      commissionRate: a.campaign.commissionRate,
      promoCode: a.promoCode,
      utmLink: a.utmLink,
      accepted: a.accepted,
      clicks: a.clicks,
      conversions: a.conversions,
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
