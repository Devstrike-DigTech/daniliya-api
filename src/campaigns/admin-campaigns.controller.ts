import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CampaignStatus, SubmissionStatus } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { CampaignsService } from './campaigns.service';
import {
  AssignInfluencersDto,
  CreateCampaignDto,
  ReviewSubmissionDto,
} from './dto/campaign.dto';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('admin: campaigns')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/campaigns')
export class AdminCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a campaign (FLAT/CPA or COMMISSION)' })
  create(
    @Body() dto: CreateCampaignDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.campaigns.create(dto, adminId, ipOf(req));
  }

  @Get()
  @ApiOperation({ summary: 'List campaigns' })
  list() {
    return this.campaigns.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Campaign detail + assignments' })
  get(@Param('id') id: string) {
    return this.campaigns.get(id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  pause(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.campaigns.setStatus(
      id,
      CampaignStatus.PAUSED,
      adminId,
      ipOf(req),
    );
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  resume(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.campaigns.setStatus(
      id,
      CampaignStatus.ACTIVE,
      adminId,
      ipOf(req),
    );
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  end(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.campaigns.setStatus(
      id,
      CampaignStatus.ENDED,
      adminId,
      ipOf(req),
    );
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assign influencers (issues per-creator promo + UTM)',
  })
  assign(
    @Param('id') id: string,
    @Body() dto: AssignInfluencersDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.campaigns.assign(id, dto, adminId, ipOf(req));
  }

  @Get(':id/submissions')
  @ApiOperation({ summary: 'Post submissions for a campaign' })
  submissions(@Param('id') id: string) {
    return this.campaigns.submissions(id);
  }

  @Post('submissions/:sid/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('sid') sid: string,
    @Body() dto: ReviewSubmissionDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.campaigns.reviewSubmission(
      sid,
      SubmissionStatus.APPROVED,
      dto,
      adminId,
      ipOf(req),
    );
  }

  @Post('submissions/:sid/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('sid') sid: string,
    @Body() dto: ReviewSubmissionDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.campaigns.reviewSubmission(
      sid,
      SubmissionStatus.REJECTED,
      dto,
      adminId,
      ipOf(req),
    );
  }
}
