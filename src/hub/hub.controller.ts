import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/booking.dto';
import { VerticalsService } from './verticals.service';

@ApiTags('services')
@Controller()
export class HubController {
  constructor(
    private readonly verticals: VerticalsService,
    private readonly bookings: BookingsService,
  ) {}

  @Public()
  @Get('services')
  @ApiOperation({ summary: 'List service verticals' })
  listServices() {
    return this.verticals.list();
  }

  @Public()
  @Get('services/:slug')
  @ApiOperation({ summary: 'Service vertical detail' })
  service(@Param('slug') slug: string) {
    return this.verticals.bySlug(slug);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('bookings/quote')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request a service quote (guest or signed in)' })
  quote(
    @Body() dto: CreateBookingDto,
    @Req() req: Request & { user?: { id: string } },
  ) {
    return this.bookings.create(dto, req.user?.id ?? null);
  }

  @ApiBearerAuth()
  @Get('bookings')
  @ApiOperation({ summary: 'My bookings' })
  mine(@CurrentUser('id') userId: string) {
    return this.bookings.mine(userId);
  }

  @ApiBearerAuth()
  @Get('bookings/:ref')
  @ApiOperation({ summary: 'My booking detail' })
  byRef(@CurrentUser('id') userId: string, @Param('ref') ref: string) {
    return this.bookings.byRef(ref, userId);
  }
}
