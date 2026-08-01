import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAssessmentQuestionDto,
  CreateTutorialStepDto,
  UpdateAssessmentQuestionDto,
  UpdateTutorialStepDto,
} from './dto/onboarding-content.dto';

/**
 * Admin authoring for the affiliate onboarding content — tutorial lessons and
 * assessment questions. Replaces the seed as the source of truth so the
 * marketing team can publish lessons and edit questions without a redeploy.
 */
@Injectable()
export class OnboardingContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Tutorial steps ────────────────────────────────────────────────────────

  /** Every lesson, published or not, in display order. */
  listTutorial() {
    return this.prisma.tutorialStep.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createTutorial(
    dto: CreateTutorialStepDto,
    adminId?: string,
    ip?: string,
  ) {
    const max = await this.prisma.tutorialStep.aggregate({
      _max: { sortOrder: true },
    });
    const created = await this.prisma.tutorialStep.create({
      data: {
        title: dto.title.trim(),
        content: dto.content?.trim() || null,
        videoUrl: dto.videoUrl?.trim() || null,
        isPublished: dto.isPublished ?? false,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'onboarding.tutorial.create',
      targetType: 'TutorialStep',
      targetId: created.id,
      after: { title: created.title, isPublished: created.isPublished },
      ip,
    });
    return created;
  }

  async updateTutorial(
    id: string,
    dto: UpdateTutorialStepDto,
    adminId?: string,
    ip?: string,
  ) {
    const before = await this.prisma.tutorialStep.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Lesson not found');

    const updated = await this.prisma.tutorialStep.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.content !== undefined
          ? { content: dto.content.trim() || null }
          : {}),
        ...(dto.videoUrl !== undefined
          ? { videoUrl: dto.videoUrl.trim() || null }
          : {}),
        ...(dto.isPublished !== undefined
          ? { isPublished: dto.isPublished }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'onboarding.tutorial.update',
      targetType: 'TutorialStep',
      targetId: id,
      before: { title: before.title, isPublished: before.isPublished },
      after: { title: updated.title, isPublished: updated.isPublished },
      ip,
    });
    return updated;
  }

  /**
   * Delete a lesson. Refused once affiliates have progress against it — that
   * history references it — so unpublish instead to hide it.
   */
  async removeTutorial(id: string, adminId?: string, ip?: string) {
    const step = await this.prisma.tutorialStep.findUnique({
      where: { id },
      include: { _count: { select: { progress: true } } },
    });
    if (!step) throw new NotFoundException('Lesson not found');
    if (step._count.progress > 0) {
      throw new BadRequestException(
        'Affiliates have already completed this lesson. Unpublish it instead of deleting.',
      );
    }
    await this.prisma.tutorialStep.delete({ where: { id } });
    await this.audit.record({
      actorId: adminId,
      action: 'onboarding.tutorial.delete',
      targetType: 'TutorialStep',
      targetId: id,
      before: { title: step.title },
      ip,
    });
    return { deleted: true };
  }

  // ── Assessment questions ──────────────────────────────────────────────────

  listQuestions() {
    return this.prisma.assessmentQuestion.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  async createQuestion(
    dto: CreateAssessmentQuestionDto,
    adminId?: string,
    ip?: string,
  ) {
    const options = this.cleanOptions(dto.options);
    const correctOption = dto.correctOption.trim();
    this.assertCorrectInOptions(options, correctOption);

    const created = await this.prisma.assessmentQuestion.create({
      data: {
        text: dto.text.trim(),
        options: options as unknown as Prisma.InputJsonValue,
        correctOption,
        explanation: dto.explanation?.trim() || null,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'onboarding.assessment.create',
      targetType: 'AssessmentQuestion',
      targetId: created.id,
      after: { text: created.text, isActive: created.isActive },
      ip,
    });
    return created;
  }

  async updateQuestion(
    id: string,
    dto: UpdateAssessmentQuestionDto,
    adminId?: string,
    ip?: string,
  ) {
    const before = await this.prisma.assessmentQuestion.findUnique({
      where: { id },
    });
    if (!before) throw new NotFoundException('Question not found');

    // Re-validate the correct answer against whichever set of options ends up
    // stored — the new options if supplied, otherwise the existing ones.
    const nextOptions =
      dto.options !== undefined
        ? this.cleanOptions(dto.options)
        : (before.options as unknown as string[]);
    const nextCorrect =
      dto.correctOption !== undefined
        ? dto.correctOption.trim()
        : before.correctOption;
    if (dto.options !== undefined || dto.correctOption !== undefined) {
      this.assertCorrectInOptions(nextOptions, nextCorrect);
    }

    const updated = await this.prisma.assessmentQuestion.update({
      where: { id },
      data: {
        ...(dto.text !== undefined ? { text: dto.text.trim() } : {}),
        ...(dto.options !== undefined
          ? { options: nextOptions as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.correctOption !== undefined
          ? { correctOption: nextCorrect }
          : {}),
        ...(dto.explanation !== undefined
          ? { explanation: dto.explanation.trim() || null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'onboarding.assessment.update',
      targetType: 'AssessmentQuestion',
      targetId: id,
      before: { text: before.text, isActive: before.isActive },
      after: { text: updated.text, isActive: updated.isActive },
      ip,
    });
    return updated;
  }

  /**
   * Delete a question. Refused once it has been answered in an attempt — those
   * answers reference it — so deactivate instead.
   */
  async removeQuestion(id: string, adminId?: string, ip?: string) {
    const q = await this.prisma.assessmentQuestion.findUnique({
      where: { id },
      include: { _count: { select: { answers: true } } },
    });
    if (!q) throw new NotFoundException('Question not found');
    if (q._count.answers > 0) {
      throw new BadRequestException(
        'This question has been answered in past attempts. Deactivate it instead of deleting.',
      );
    }
    await this.prisma.assessmentQuestion.delete({ where: { id } });
    await this.audit.record({
      actorId: adminId,
      action: 'onboarding.assessment.delete',
      targetType: 'AssessmentQuestion',
      targetId: id,
      before: { text: q.text },
      ip,
    });
    return { deleted: true };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Trim, drop blanks, and reject duplicate choices. */
  private cleanOptions(options: string[]): string[] {
    const cleaned = options.map((o) => o.trim()).filter(Boolean);
    if (cleaned.length < 2) {
      throw new BadRequestException('Provide at least two answer choices');
    }
    if (new Set(cleaned).size !== cleaned.length) {
      throw new BadRequestException('Answer choices must be unique');
    }
    return cleaned;
  }

  private assertCorrectInOptions(options: string[], correct: string) {
    if (!options.includes(correct)) {
      throw new BadRequestException(
        'The correct answer must exactly match one of the options',
      );
    }
  }
}
