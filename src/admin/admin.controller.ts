import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { RejectProductDto } from './dto/admin.dto';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Command centre — GMV, orders, users, pending payouts, attribution' })
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
    return this.admin.auditLog({ actor, action, target, page: Number(page) || undefined, limit: Number(limit) || undefined });
  }

  // Products moderation
  @Get('products')
  products(@Query('status') status?: ProductStatus, @Query('q') q?: string) {
    return this.admin.products(status, q);
  }
  @Post('products/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string, @CurrentUser('id') a: string, @Req() r: Request) {
    return this.admin.approveProduct(id, a, ipOf(r));
  }
  @Post('products/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id') id: string, @Body() dto: RejectProductDto, @CurrentUser('id') a: string, @Req() r: Request) {
    return this.admin.rejectProduct(id, dto, a, ipOf(r));
  }
}
