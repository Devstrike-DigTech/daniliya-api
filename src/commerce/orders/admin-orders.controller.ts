import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role, Roles } from '../../common/decorators/roles.decorator';
import { AdminOrdersService } from './admin-orders.service';
import { AdvanceOrderDto } from './dto/orders.dto';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('admin: orders')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List orders (optionally by status)' })
  list(@Query('status') status?: OrderStatus) {
    return this.orders.list(status);
  }

  @Get(':ref')
  @ApiOperation({ summary: 'Order detail' })
  byRef(@Param('ref') ref: string) {
    return this.orders.byRef(ref);
  }

  @Post(':ref/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Advance fulfilment — PROCESSING/SHIPPED/DELIVERED/COMPLETED',
  })
  advance(
    @Param('ref') ref: string,
    @Body() dto: AdvanceOrderDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.orders.advance(ref, dto, adminId, ipOf(req));
  }

  @Post(':ref/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refund an order — voids commissions, restores stock',
  })
  refund(
    @Param('ref') ref: string,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.orders.refund(ref, adminId, ipOf(req));
  }

  @Post(':ref/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an order — voids commissions, restores stock',
  })
  cancel(
    @Param('ref') ref: string,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.orders.cancel(ref, adminId, ipOf(req));
  }
}
