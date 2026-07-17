import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { AffiliateService } from './affiliate.service';

@ApiTags('affiliate')
@ApiBearerAuth()
@Roles(Role.AFFILIATE)
@Controller('affiliate')
export class AffiliateController {
  constructor(private readonly affiliate: AffiliateService) {}

  @Get('overview')
  @ApiOperation({ summary: 'KPIs — lifetime earnings, pending, tier, conversions' })
  overview(@CurrentUser('id') userId: string) {
    return this.affiliate.overview(userId);
  }

  @Get('links')
  @ApiOperation({ summary: 'Master + per-product referral links' })
  links(@CurrentUser('id') userId: string) {
    return this.affiliate.links(userId);
  }

  @Get('earnings')
  @ApiOperation({ summary: 'Commission ledger + summary' })
  earnings(@CurrentUser('id') userId: string) {
    return this.affiliate.earnings(userId);
  }

  @Get('referrals')
  @ApiOperation({ summary: 'Customers referred by my code' })
  referrals(@CurrentUser('id') userId: string) {
    return this.affiliate.referrals(userId);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Top affiliates + my rank' })
  leaderboard(@CurrentUser('id') userId: string) {
    return this.affiliate.leaderboard(userId);
  }
}
