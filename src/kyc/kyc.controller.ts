import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { KycStatus } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { KycService } from './kyc.service';
import { ReviewKycDto, SubmitKycDto } from './dto/kyc.dto';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('kyc')
@ApiBearerAuth()
@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Post()
  @ApiOperation({ summary: 'Submit KYC (government ID + payout account)' })
  submit(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitKycDto,
    @Req() req: Request,
  ) {
    return this.kyc.submit(userId, dto, ipOf(req));
  }

  @Get('me')
  @ApiOperation({ summary: 'My KYC status' })
  mine(@CurrentUser('id') userId: string) {
    return this.kyc.mine(userId);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/kyc')
export class AdminKycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  @ApiOperation({ summary: 'KYC review queue' })
  list(@Query('status') status?: KycStatus) {
    return this.kyc.listForReview(status);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a KYC submission' })
  approve(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.kyc.review(adminId, id, 'approve', undefined, ipOf(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a KYC submission (reason required)' })
  reject(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() dto: ReviewKycDto,
    @Req() req: Request,
  ) {
    return this.kyc.review(adminId, id, 'reject', dto.reason, ipOf(req));
  }
}
