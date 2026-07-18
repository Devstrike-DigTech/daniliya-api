import { Module } from '@nestjs/common';
import { VendorController } from './vendor.controller';
import { VendorOrdersService } from './vendor-orders.service';
import { VendorOverviewService } from './vendor-overview.service';

@Module({
  controllers: [VendorController],
  providers: [VendorOrdersService, VendorOverviewService],
})
export class VendorModule {}
