import { Module } from '@nestjs/common';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminVerticalsController } from './admin-verticals.controller';
import { BookingsService } from './bookings.service';
import { HubController } from './hub.controller';
import { VerticalsService } from './verticals.service';

@Module({
  controllers: [HubController, AdminBookingsController, AdminVerticalsController],
  providers: [VerticalsService, BookingsService],
})
export class HubModule {}
