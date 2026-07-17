import { Module } from '@nestjs/common';
import { AdminKycController, KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { SmileIdService } from './smile-id.service';

@Module({
  controllers: [KycController, AdminKycController],
  providers: [KycService, SmileIdService],
  exports: [KycService],
})
export class KycModule {}
