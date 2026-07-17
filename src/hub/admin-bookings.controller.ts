import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { BookingsService } from './bookings.service';
import { AcceptBookingDto, CancelBookingDto } from './dto/booking.dto';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('admin: bookings')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'List bookings (optionally by status)' })
  list(@Query('status') status?: BookingStatus) {
    return this.bookings.list(status);
  }

  @Get(':ref')
  @ApiOperation({ summary: 'Booking detail' })
  detail(@Param('ref') ref: string) {
    return this.bookings.adminByRef(ref);
  }

  @Post(':ref/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a request → CONFIRMED (optional quote)' })
  accept(
    @Param('ref') ref: string,
    @Body() dto: AcceptBookingDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.bookings.accept(ref, dto, adminId, ipOf(req));
  }

  @Post(':ref/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark IN_PROGRESS' })
  start(@Param('ref') ref: string, @CurrentUser('id') adminId: string, @Req() req: Request) {
    return this.bookings.start(ref, adminId, ipOf(req));
  }

  @Post(':ref/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark COMPLETED' })
  complete(@Param('ref') ref: string, @CurrentUser('id') adminId: string, @Req() req: Request) {
    return this.bookings.complete(ref, adminId, ipOf(req));
  }

  @Post(':ref/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a request → CANCELLED' })
  reject(
    @Param('ref') ref: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.bookings.reject(ref, dto, adminId, ipOf(req));
  }

  @Post(':ref/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a booking → CANCELLED' })
  cancel(
    @Param('ref') ref: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.bookings.cancel(ref, dto, adminId, ipOf(req));
  }
}
