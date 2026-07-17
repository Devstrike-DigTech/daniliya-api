import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { KycStatus, UserRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  InfluencerApplicationDto,
  SelectableRole,
  SubmitAssessmentDto,
  VendorApplicationDto,
} from './dto/onboarding.dto';

/** Mirrors the portals: 60% to pass, 10 retakes, 8-minute timer. */
export const ASSESSMENT_PASS_PCT = 60;
export const ASSESSMENT_MAX_ATTEMPTS = 10;
export const ASSESSMENT_TIMER_SECONDS = 8 * 60;
/** Small grace so a submit in flight at the buzzer isn't punished by latency. */
const SUBMIT_GRACE_SECONDS = 15;

interface AssessmentSession {
  questionIds: string[];
  startedAt: number;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  // ── Role selection ────────────────────────────────────────────────────

  async selectRole(userId: string, role: SelectableRole, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { affiliateProfile: true, influencerProfile: true, vendorProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException('Admin accounts cannot change role');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { role: role as UserRole } });

      if (role === 'AFFILIATE' && !user.affiliateProfile) {
        await tx.affiliateProfile.create({ data: { userId } });
      }
      if (role === 'INFLUENCER' && !user.influencerProfile) {
        await tx.influencerProfile.create({ data: { userId, socialHandles: {} } });
      }
      if (role === 'VENDOR' && !user.vendorProfile) {
        await tx.vendorProfile.create({ data: { userId, businessName: '' } });
      }
    });

    await this.audit.record({
      actorId: userId,
      action: 'Selected role',
      targetType: 'User',
      targetId: userId,
      before: { role: user.role },
      after: { role },
      ip,
    });

    return this.status(userId);
  }

  // ── Status ────────────────────────────────────────────────────────────

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        affiliateProfile: true,
        influencerProfile: true,
        vendorProfile: true,
        kycSubmission: { select: { status: true, reason: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const kycStatus = user.kycSubmission?.status ?? null;
    const base = {
      role: user.role,
      accountStatus: user.status,
      kycStatus,
      kycReason: user.kycSubmission?.reason ?? null,
    };

    if (user.role === UserRole.AFFILIATE) {
      const [tutorial, attempts] = await Promise.all([
        this.tutorialProgress(userId),
        this.attemptCount(userId),
      ]);
      const p = user.affiliateProfile;
      return {
        ...base,
        step: this.affiliateStep(kycStatus, tutorial.completed, p?.assessmentPassed ?? false, attempts),
        tutorial,
        assessment: {
          passed: p?.assessmentPassed ?? false,
          attemptsUsed: attempts,
          retakesLeft: Math.max(0, ASSESSMENT_MAX_ATTEMPTS - attempts),
          passMark: ASSESSMENT_PASS_PCT,
        },
        isActive: p?.isActive ?? false,
        referralCode: p?.referralCode ?? null,
      };
    }

    if (user.role === UserRole.INFLUENCER) {
      const p = user.influencerProfile;
      return {
        ...base,
        step: p?.isApproved ? 'approved' : p?.rejectedReason ? 'rejected' : 'review',
        approved: p?.isApproved ?? false,
        rejectedReason: p?.rejectedReason ?? null,
        code: p?.influencerCode ?? null,
      };
    }

    if (user.role === UserRole.VENDOR) {
      const p = user.vendorProfile;
      return {
        ...base,
        step: p?.isApproved ? 'approved' : p?.rejectedReason ? 'rejected' : 'review',
        approved: p?.isApproved ?? false,
        rejectedReason: p?.rejectedReason ?? null,
      };
    }

    return { ...base, step: 'done' };
  }

  /**
   * Mirrors the portal flow: kyc → tutorial → assessment → active.
   * KYC only has to be *submitted* to move on — verification runs async and
   * gates payouts, not the tutorial/assessment.
   */
  private affiliateStep(
    kyc: KycStatus | null,
    tutorialDone: boolean,
    passed: boolean,
    attempts: number,
  ) {
    if (passed) return 'active';
    if (!kyc) return 'kyc';
    if (kyc === KycStatus.REJECTED) return 'kyc-rejected';
    if (!tutorialDone) return 'tutorial';
    if (attempts >= ASSESSMENT_MAX_ATTEMPTS) return 'locked';
    return 'assessment';
  }

  // ── Tutorial ──────────────────────────────────────────────────────────

  async tutorial(userId: string) {
    const profile = await this.affiliateOrThrow(userId);

    const [steps, done] = await Promise.all([
      this.prisma.tutorialStep.findMany({
        where: { isPublished: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.affiliateTutorialProgress.findMany({
        where: { affiliateId: profile.id },
        select: { stepId: true },
      }),
    ]);

    const doneIds = new Set(done.map((d) => d.stepId));
    return steps.map((s) => ({ ...s, completed: doneIds.has(s.id) }));
  }

  async completeStep(userId: string, stepId: string) {
    const profile = await this.affiliateOrThrow(userId);

    const step = await this.prisma.tutorialStep.findUnique({ where: { id: stepId } });
    if (!step || !step.isPublished) throw new NotFoundException('Lesson not found');

    await this.prisma.affiliateTutorialProgress.upsert({
      where: { affiliateId_stepId: { affiliateId: profile.id, stepId } },
      create: { affiliateId: profile.id, stepId },
      update: {},
    });

    const progress = await this.tutorialProgress(userId);
    if (progress.completed && !profile.tutorialCompleted) {
      await this.prisma.affiliateProfile.update({
        where: { id: profile.id },
        data: { tutorialCompleted: true },
      });
    }

    return progress;
  }

  private async tutorialProgress(userId: string) {
    const profile = await this.prisma.affiliateProfile.findUnique({ where: { userId } });
    if (!profile) return { total: 0, done: 0, completed: false };

    const [total, done] = await Promise.all([
      this.prisma.tutorialStep.count({ where: { isPublished: true } }),
      this.prisma.affiliateTutorialProgress.count({ where: { affiliateId: profile.id } }),
    ]);

    return { total, done, completed: total > 0 && done >= total };
  }

  // ── Assessment ────────────────────────────────────────────────────────

  /** Starts a timed attempt and serves the questions WITHOUT the answers. */
  async startAssessment(userId: string) {
    const profile = await this.affiliateOrThrow(userId);

    if (profile.assessmentPassed) {
      throw new BadRequestException('You have already passed the assessment');
    }
    if (!(await this.tutorialProgress(userId)).completed) {
      throw new BadRequestException('Finish the tutorial before taking the assessment');
    }

    const attempts = await this.attemptCount(userId);
    if (attempts >= ASSESSMENT_MAX_ATTEMPTS) {
      throw new ForbiddenException('You have used all your attempts. Contact support.');
    }

    const questions = await this.prisma.assessmentQuestion.findMany({
      where: { isActive: true },
      select: { id: true, text: true, options: true },
    });
    if (questions.length === 0) {
      throw new BadRequestException('No assessment questions are configured');
    }

    const session: AssessmentSession = {
      questionIds: questions.map((q) => q.id),
      startedAt: Date.now(),
    };
    await this.redis.set(
      this.sessionKey(userId),
      session,
      ASSESSMENT_TIMER_SECONDS + SUBMIT_GRACE_SECONDS,
    );

    return {
      questions,
      timerSeconds: ASSESSMENT_TIMER_SECONDS,
      expiresAt: new Date(session.startedAt + ASSESSMENT_TIMER_SECONDS * 1000),
      passMark: ASSESSMENT_PASS_PCT,
      attemptsUsed: attempts,
      retakesLeft: ASSESSMENT_MAX_ATTEMPTS - attempts,
    };
  }

  async submitAssessment(userId: string, dto: SubmitAssessmentDto, ip?: string) {
    const profile = await this.affiliateOrThrow(userId);
    if (profile.assessmentPassed) {
      throw new BadRequestException('You have already passed the assessment');
    }

    const session = await this.redis.get<AssessmentSession>(this.sessionKey(userId));
    if (!session) {
      throw new BadRequestException('Your attempt expired or was never started');
    }

    const elapsed = (Date.now() - session.startedAt) / 1000;
    if (elapsed > ASSESSMENT_TIMER_SECONDS + SUBMIT_GRACE_SECONDS) {
      await this.redis.del(this.sessionKey(userId));
      throw new BadRequestException('Time is up — your attempt expired');
    }

    // Grade against the questions we actually served, so a client can't submit
    // answers to questions it was never given.
    const questions = await this.prisma.assessmentQuestion.findMany({
      where: { id: { in: session.questionIds } },
    });
    const byId = new Map(questions.map((q) => [q.id, q]));

    const graded = dto.answers
      .filter((a) => byId.has(a.questionId))
      .map((a) => {
        const q = byId.get(a.questionId)!;
        return {
          questionId: a.questionId,
          selected: a.selected,
          isCorrect: q.correctOption === a.selected,
        };
      });

    const correct = graded.filter((g) => g.isCorrect).length;
    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= ASSESSMENT_PASS_PCT;

    const attempt = await this.prisma.assessmentAttempt.create({
      data: {
        affiliateId: profile.id,
        score,
        passed,
        answers: { create: graded },
      },
    });

    await this.redis.del(this.sessionKey(userId));

    let referralCode: string | null = profile.referralCode;
    if (passed) {
      referralCode = profile.referralCode ?? (await this.issueReferralCode(userId));
      await this.prisma.affiliateProfile.update({
        where: { id: profile.id },
        data: { assessmentPassed: true, isActive: true, referralCode },
      });
    }

    const attemptsUsed = await this.attemptCount(userId);

    await this.audit.record({
      actorId: userId,
      action: passed ? 'Passed affiliate assessment' : 'Failed affiliate assessment',
      targetType: 'AssessmentAttempt',
      targetId: attempt.id,
      after: { score, passed, attemptsUsed },
      ip,
    });

    return {
      score,
      passed,
      correct,
      total: questions.length,
      passMark: ASSESSMENT_PASS_PCT,
      attemptsUsed,
      retakesLeft: Math.max(0, ASSESSMENT_MAX_ATTEMPTS - attemptsUsed),
      referralCode: passed ? referralCode : null,
      isActive: passed,
    };
  }

  // ── Role applications (manual review) ─────────────────────────────────

  async applyInfluencer(userId: string, dto: InfluencerApplicationDto, ip?: string) {
    if (!Object.keys(dto.socialHandles ?? {}).length) {
      throw new BadRequestException('Provide at least one social handle');
    }

    const profile = await this.prisma.influencerProfile.upsert({
      where: { userId },
      create: {
        userId,
        niche: dto.niche,
        followerCount: dto.followerCount,
        socialHandles: dto.socialHandles,
        contentLinks: dto.contentLinks ?? [],
      },
      update: {
        niche: dto.niche,
        followerCount: dto.followerCount,
        socialHandles: dto.socialHandles,
        contentLinks: dto.contentLinks ?? [],
        rejectedReason: null,
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { role: UserRole.INFLUENCER },
    });

    await this.audit.record({
      actorId: userId,
      action: 'Submitted influencer application',
      targetType: 'InfluencerProfile',
      targetId: profile.id,
      ip,
    });

    return this.status(userId);
  }

  async applyVendor(userId: string, dto: VendorApplicationDto, ip?: string) {
    const profile = await this.prisma.vendorProfile.upsert({
      where: { userId },
      create: {
        userId,
        businessName: dto.businessName,
        productCategory: dto.productCategory,
      },
      update: {
        businessName: dto.businessName,
        productCategory: dto.productCategory,
        rejectedReason: null,
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { role: UserRole.VENDOR },
    });

    await this.audit.record({
      actorId: userId,
      action: 'Submitted vendor application',
      targetType: 'VendorProfile',
      targetId: profile.id,
      ip,
    });

    return this.status(userId);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async affiliateOrThrow(userId: string) {
    const profile = await this.prisma.affiliateProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new ForbiddenException('Select the affiliate role first');
    }
    return profile;
  }

  private attemptCount(userId: string) {
    return this.prisma.assessmentAttempt.count({
      where: { affiliate: { userId } },
    });
  }

  /** e.g. ADA-7K2P — permanent, tied to all historical referrals. */
  private async issueReferralCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const base = (user?.firstName ?? 'DAN')
      .replace(/[^a-zA-Z]/g, '')
      .slice(0, 3)
      .toUpperCase()
      .padEnd(3, 'X');

    for (let i = 0; i < 10; i++) {
      const suffix = randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
      const code = `${base}-${suffix}`;
      const taken = await this.prisma.affiliateProfile.findUnique({
        where: { referralCode: code },
      });
      if (!taken) return code;
    }
    throw new Error('Could not allocate a unique referral code');
  }

  private sessionKey(userId: string) {
    return `assessment:session:${userId}`;
  }
}
