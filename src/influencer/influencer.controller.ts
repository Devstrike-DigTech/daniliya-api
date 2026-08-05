import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { UpdateInfluencerProfileDto } from './dto/influencer.dto';
import { InfluencerService } from './influencer.service';

@ApiTags('influencer')
@ApiBearerAuth()
@Roles(Role.INFLUENCER)
@Controller('influencer')
export class InfluencerController {
  constructor(private readonly influencer: InfluencerService) {}

  @Get('profile')
  @ApiOperation({ summary: 'My creator profile (niche, following, bio, socials)' })
  profile(@CurrentUser('id') userId: string) {
    return this.influencer.profile(userId);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update my creator profile' })
  update(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateInfluencerProfileDto,
  ) {
    return this.influencer.updateProfile(userId, dto);
  }
}
