import { Global, Module } from '@nestjs/common';
import { CommissionsService } from './commissions.service';

@Global()
@Module({
  providers: [CommissionsService],
  exports: [CommissionsService],
})
export class CommissionsModule {}
