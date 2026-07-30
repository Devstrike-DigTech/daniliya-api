import { Module } from '@nestjs/common';
import { EncryptionService } from '../common/encryption.service';
import { AdminKycController, KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { SmileIdService } from './smile-id.service';

@Module({
  controllers: [KycController, AdminKycController],
  providers: [KycService, SmileIdService, EncryptionService],
  exports: [KycService],
})
export class KycModule {}
