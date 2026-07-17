import { Module } from '@nestjs/common';
import { AdminCampaignsController } from './admin-campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { InfluencerCampaignsController } from './influencer-campaigns.controller';

@Module({
  controllers: [AdminCampaignsController, InfluencerCampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
