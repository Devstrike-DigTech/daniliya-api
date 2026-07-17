import { Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService } from '../payments/payments.service';
import { PayoutsService } from '../payouts/payouts.service';

@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
  ) {}

  @Public()
  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  paystack(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    // Verify against the RAW body — a re-serialized JSON won't match the HMAC.
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
    return this.payments.handlePaystackWebhook(raw, signature);
  }

  @Public()
  @Post('transfer')
  @HttpCode(HttpStatus.OK)
  transfer(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
    return this.payouts.handleTransferWebhook(raw, signature);
  }
}
