import { Module } from '@nestjs/common';
import { AdminBookingsController } from './admin-bookings.controller';
import { BookingsService } from './bookings.service';
import { HubController } from './hub.controller';
import { VerticalsService } from './verticals.service';

@Module({
  controllers: [HubController, AdminBookingsController],
  providers: [VerticalsService, BookingsService],
})
export class HubModule {}
