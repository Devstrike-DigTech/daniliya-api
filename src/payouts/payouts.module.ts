import { Module } from '@nestjs/common';
import {
  AdminPayoutsController,
  MyPayoutsController,
} from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  controllers: [AdminPayoutsController, MyPayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
