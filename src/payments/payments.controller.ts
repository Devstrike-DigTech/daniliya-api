import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Verify a Paystack transaction and confirm its order.
   *
   * Public because the buyer lands here straight from Paystack's redirect,
   * before any session is guaranteed (guest checkout). It leaks nothing beyond
   * the order's own reference and paid/not-paid — which the buyer already has —
   * and confirms only on a real Paystack success.
   */
  @Public()
  @Get('verify')
  @ApiOperation({ summary: 'Verify a payment on return from the gateway' })
  verify(@Query('reference') reference?: string) {
    if (!reference) throw new BadRequestException('reference is required');
    return this.payments.verifyAndConfirm(reference);
  }
}
