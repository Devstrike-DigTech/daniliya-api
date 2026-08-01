import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { ResourcesService } from './resources.service';

@ApiTags('affiliate: resources')
@ApiBearerAuth()
@Roles(Role.AFFILIATE)
@Controller('affiliate/resources')
export class AffiliateResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Get()
  @ApiOperation({ summary: 'Global resources + products that have their own kits' })
  landing() {
    return this.resources.affiliateLanding();
  }

  @Get(':productId')
  @ApiOperation({ summary: "A product's kit (its resources + global ones)" })
  kit(@Param('productId') productId: string) {
    return this.resources.productKit(productId);
  }
}
