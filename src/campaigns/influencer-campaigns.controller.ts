import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { CampaignsService } from './campaigns.service';
import { SubmitPostDto } from './dto/campaign.dto';

@ApiTags('influencer: campaigns')
@ApiBearerAuth()
@Roles(Role.INFLUENCER)
@Controller('influencer')
export class InfluencerCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get('campaigns')
  @ApiOperation({ summary: 'My assigned campaigns (brief, promo, UTM, metrics)' })
  mine(@CurrentUser('id') userId: string) {
    return this.campaigns.myCampaigns(userId);
  }

  @Post('campaigns/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a campaign brief' })
  accept(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.campaigns.accept(userId, id);
  }

  @Post('campaigns/:id/submissions')
  @ApiOperation({ summary: 'Submit proof of post' })
  submit(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: SubmitPostDto) {
    return this.campaigns.submitPost(userId, id, dto);
  }

  @Get('earnings')
  @ApiOperation({ summary: 'My CPA earnings' })
  earnings(@CurrentUser('id') userId: string) {
    return this.campaigns.myEarnings(userId);
  }
}
