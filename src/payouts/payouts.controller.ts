import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PayoutAudience, PayoutBatchStatus } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { LedgerService } from '../ledger/ledger.service';
import { PayoutsService } from './payouts.service';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('admin: payouts')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly ledger: LedgerService,
  ) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run the payout batch (confirm commissions + batch by audience)' })
  run(@CurrentUser('id') adminId: string, @Req() req: Request) {
    return this.payouts.run(adminId, ipOf(req));
  }

  @Get()
  @ApiOperation({ summary: 'List payout batches' })
  list(@Query('audience') audience?: PayoutAudience, @Query('status') status?: PayoutBatchStatus) {
    return this.payouts.list(audience, status);
  }

  @Get('reconciliation')
  @ApiOperation({ summary: 'Ledger reconciliation (drift check)' })
  reconcile() {
    return this.ledger.reconcile();
  }

  @Get(':ref')
  @ApiOperation({ summary: 'Batch detail — items + compliance checks' })
  detail(@Param('ref') ref: string) {
    return this.payouts.detail(ref);
  }

  @Post(':ref/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve & schedule (gated on compliance) → initiates transfers' })
  approve(@Param('ref') ref: string, @CurrentUser('id') adminId: string, @Req() req: Request) {
    return this.payouts.approve(ref, adminId, ipOf(req));
  }

  @Post(':ref/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry failed transfers' })
  retry(@Param('ref') ref: string, @CurrentUser('id') adminId: string, @Req() req: Request) {
    return this.payouts.retry(ref, adminId, ipOf(req));
  }

  @Post(':ref/hold')
  @HttpCode(HttpStatus.OK)
  hold(@Param('ref') ref: string, @CurrentUser('id') adminId: string, @Req() req: Request) {
    return this.payouts.hold(ref, adminId, ipOf(req));
  }

  @Post(':ref/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('ref') ref: string, @CurrentUser('id') adminId: string, @Req() req: Request) {
    return this.payouts.cancel(ref, adminId, ipOf(req));
  }
}

@ApiTags('payouts')
@ApiBearerAuth()
@Controller('me/payouts')
export class MyPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  @ApiOperation({ summary: 'My wallet balance + payout history' })
  mine(@CurrentUser('id') userId: string) {
    return this.payouts.myPayouts(userId);
  }
}
