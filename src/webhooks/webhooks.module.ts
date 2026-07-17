import { Module } from '@nestjs/common';
import { PayoutsModule } from '../payouts/payouts.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [PayoutsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
