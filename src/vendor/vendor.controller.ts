import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { MarkShippedDto, UpdateVendorProfileDto } from './dto/vendor.dto';
import { VendorOrdersService } from './vendor-orders.service';
import { VendorOverviewService } from './vendor-overview.service';

@ApiTags('vendor')
@ApiBearerAuth()
@Roles(Role.VENDOR)
@Controller('vendor')
export class VendorController {
  constructor(
    private readonly orders: VendorOrdersService,
    private readonly overviewService: VendorOverviewService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Storefront summary — products, despatch queue, sales, rating',
  })
  overview(@CurrentUser('id') userId: string) {
    return this.overviewService.overview(userId);
  }

  @Get('orders')
  @ApiOperation({ summary: "Orders containing this vendor's products" })
  list(@CurrentUser('id') userId: string) {
    return this.orders.list(userId);
  }

  @Get('orders/:ref')
  @ApiOperation({ summary: 'Order detail, including the address to ship to' })
  byRef(@CurrentUser('id') userId: string, @Param('ref') ref: string) {
    return this.orders.byRef(userId, ref);
  }

  @Post('orders/:ref/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record despatch — creates the shipment the buyer tracks',
  })
  ship(
    @CurrentUser('id') userId: string,
    @Param('ref') ref: string,
    @Body() dto: MarkShippedDto,
  ) {
    return this.orders.markShipped(userId, ref, dto);
  }

  @Get('reviews')
  @ApiOperation({ summary: "Reviews left on this vendor's products" })
  reviews(@CurrentUser('id') userId: string) {
    return this.overviewService.reviews(userId);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update contact + business details' })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateVendorProfileDto,
  ) {
    return this.overviewService.updateProfile(userId, dto);
  }
}
