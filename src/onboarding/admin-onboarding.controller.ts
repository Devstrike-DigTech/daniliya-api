import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import {
  CreateAssessmentQuestionDto,
  CreateTutorialStepDto,
  UpdateAssessmentQuestionDto,
  UpdateTutorialStepDto,
} from './dto/onboarding-content.dto';
import { OnboardingContentService } from './onboarding-content.service';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('admin: onboarding content')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/onboarding')
export class AdminOnboardingController {
  constructor(private readonly content: OnboardingContentService) {}

  // ── Tutorial lessons ──────────────────────────────────────────────────────

  @Get('tutorial')
  @ApiOperation({ summary: 'List every tutorial lesson (published or not)' })
  listTutorial() {
    return this.content.listTutorial();
  }

  @Post('tutorial')
  @ApiOperation({ summary: 'Add a tutorial lesson' })
  createTutorial(
    @Body() dto: CreateTutorialStepDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.content.createTutorial(dto, adminId, ipOf(req));
  }

  @Patch('tutorial/:id')
  @ApiOperation({ summary: 'Edit a lesson (title, content, video, publish, order)' })
  updateTutorial(
    @Param('id') id: string,
    @Body() dto: UpdateTutorialStepDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.content.updateTutorial(id, dto, adminId, ipOf(req));
  }

  @Delete('tutorial/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a lesson (only if no affiliate has completed it)' })
  removeTutorial(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.content.removeTutorial(id, adminId, ipOf(req));
  }

  // ── Assessment questions ──────────────────────────────────────────────────

  @Get('assessment')
  @ApiOperation({ summary: 'List every assessment question (active or not)' })
  listQuestions() {
    return this.content.listQuestions();
  }

  @Post('assessment')
  @ApiOperation({ summary: 'Add an assessment question' })
  createQuestion(
    @Body() dto: CreateAssessmentQuestionDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.content.createQuestion(dto, adminId, ipOf(req));
  }

  @Patch('assessment/:id')
  @ApiOperation({ summary: 'Edit a question (text, options, correct answer, active)' })
  updateQuestion(
    @Param('id') id: string,
    @Body() dto: UpdateAssessmentQuestionDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.content.updateQuestion(id, dto, adminId, ipOf(req));
  }

  @Delete('assessment/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a question (only if never answered)' })
  removeQuestion(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.content.removeQuestion(id, adminId, ipOf(req));
  }
}
