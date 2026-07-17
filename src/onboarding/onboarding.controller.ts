import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  InfluencerApplicationDto,
  SelectRoleDto,
  SubmitAssessmentDto,
  VendorApplicationDto,
} from './dto/onboarding.dto';
import { OnboardingService } from './onboarding.service';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('status')
  @ApiOperation({ summary: 'Where the user is in the join flow' })
  status(@CurrentUser('id') userId: string) {
    return this.onboarding.status(userId);
  }

  @Post('role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Choose a role — provisions the matching profile' })
  selectRole(
    @CurrentUser('id') userId: string,
    @Body() dto: SelectRoleDto,
    @Req() req: Request,
  ) {
    return this.onboarding.selectRole(userId, dto.role, ipOf(req));
  }

  @Get('tutorial')
  @ApiOperation({ summary: 'Affiliate tutorial lessons + my progress' })
  tutorial(@CurrentUser('id') userId: string) {
    return this.onboarding.tutorial(userId);
  }

  @Post('tutorial/:stepId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a lesson complete' })
  completeStep(@CurrentUser('id') userId: string, @Param('stepId') stepId: string) {
    return this.onboarding.completeStep(userId, stepId);
  }

  @Get('assessment')
  @ApiOperation({
    summary: 'Start a timed attempt — serves 10 questions without the answers',
  })
  startAssessment(@CurrentUser('id') userId: string) {
    return this.onboarding.startAssessment(userId);
  }

  @Post('assessment/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit answers — graded server-side (60% to pass)' })
  submitAssessment(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitAssessmentDto,
    @Req() req: Request,
  ) {
    return this.onboarding.submitAssessment(userId, dto, ipOf(req));
  }

  @Post('influencer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit creator application (goes to admin review)' })
  applyInfluencer(
    @CurrentUser('id') userId: string,
    @Body() dto: InfluencerApplicationDto,
    @Req() req: Request,
  ) {
    return this.onboarding.applyInfluencer(userId, dto, ipOf(req));
  }

  @Post('vendor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit vendor application (goes to admin review)' })
  applyVendor(
    @CurrentUser('id') userId: string,
    @Body() dto: VendorApplicationDto,
    @Req() req: Request,
  ) {
    return this.onboarding.applyVendor(userId, dto, ipOf(req));
  }
}
