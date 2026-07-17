import { Module } from '@nestjs/common';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';
import { PaystackBanksService } from './paystack-banks.service';

@Module({
  controllers: [BanksController],
  providers: [BanksService, PaystackBanksService],
  exports: [BanksService, PaystackBanksService],
})
export class BanksModule {}
