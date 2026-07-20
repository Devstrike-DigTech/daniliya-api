import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { PlatformConfigService } from '../config/platform-config.service';
import { AdminService } from './admin.service';
import {
  AdminCreateProductDto,
  AdminUpdateProductDto,
  RejectProductDto,
  UpdateConfigDto,
} from './dto/admin.dto';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly config: PlatformConfigService,
  ) {}

  @Get('settings/config')
  @ApiOperation({ summary: 'Platform config (fees, take-rate, min payout)' })
  getConfig() {
    return this.config.all();
  }

  @Patch('settings/config')
  @ApiOperation({ summary: 'Update platform config (numeric values only)' })
  async updateConfig(@Body() dto: UpdateConfigDto) {
    return { updated: await this.config.update(dto.values) };
  }

  @Get('overview')
  @ApiOperation({
    summary:
      'Command centre — GMV, orders, users, pending payouts, attribution',
  })
  overview() {
    return this.admin.overview();
  }

  @Get('finance/stats')
  @ApiOperation({ summary: 'Finance metrics' })
  finance() {
    return this.admin.financeStats();
  }

  @Get('audit-log')
  @ApiOperation({ summary: 'Audit trail' })
  audit(
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('target') target?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.admin.auditLog({
      actor,
      action,
      target,
      page: Number(page) || undefined,
      limit: Number(limit) || undefined,
    });
  }

  // Products
  @Get('products')
  products(@Query('status') status?: ProductStatus, @Query('q') q?: string) {
    return this.admin.products(status, q);
  }

  // Static path — must precede the ':id' route so it isn't captured as an id.
  @Get('products/vendor-options')
  @ApiOperation({ summary: 'Approved vendors for the product form picker' })
  vendorOptions() {
    return this.admin.vendorsForSelect();
  }

  @Post('products')
  @ApiOperation({ summary: 'Create a product (platform-owned or for a vendor)' })
  createProduct(
    @Body() dto: AdminCreateProductDto,
    @CurrentUser('id') a: string,
    @Req() r: Request,
  ) {
    return this.admin.createProduct(dto, a, ipOf(r));
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Product detail (any status)' })
  product(@Param('id') id: string) {
    return this.admin.product(id);
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Edit a product (fields, vendor, images)' })
  updateProduct(
    @Param('id') id: string,
    @Body() dto: AdminUpdateProductDto,
    @CurrentUser('id') a: string,
    @Req() r: Request,
  ) {
    return this.admin.updateProduct(id, dto, a, ipOf(r));
  }

  @Post('products/:id/delist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take a product off the storefront' })
  delist(
    @Param('id') id: string,
    @CurrentUser('id') a: string,
    @Req() r: Request,
  ) {
    return this.admin.delistProduct(id, a, ipOf(r));
  }

  @Post('products/:id/relist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put a product back on the storefront' })
  relist(
    @Param('id') id: string,
    @CurrentUser('id') a: string,
    @Req() r: Request,
  ) {
    return this.admin.relistProduct(id, a, ipOf(r));
  }
  @Post('products/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id') id: string,
    @CurrentUser('id') a: string,
    @Req() r: Request,
  ) {
    return this.admin.approveProduct(id, a, ipOf(r));
  }
  @Post('products/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectProductDto,
    @CurrentUser('id') a: string,
    @Req() r: Request,
  ) {
    return this.admin.rejectProduct(id, dto, a, ipOf(r));
  }
}
