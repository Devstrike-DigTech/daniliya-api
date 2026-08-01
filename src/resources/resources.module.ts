import { Module } from '@nestjs/common';
import { AdminResourcesController } from './admin-resources.controller';
import { AffiliateResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';

@Module({
  controllers: [AffiliateResourcesController, AdminResourcesController],
  providers: [ResourcesService],
})
export class ResourcesModule {}
