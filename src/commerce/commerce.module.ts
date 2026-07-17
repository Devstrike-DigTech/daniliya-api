import { Module } from '@nestjs/common';
import { CartController } from './cart/cart.controller';
import { CartService } from './cart/cart.service';
import { AdminOrdersController } from './orders/admin-orders.controller';
import { AdminOrdersService } from './orders/admin-orders.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { PricingService } from './pricing.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { VendorProductsController } from './products/vendor-products.controller';
import { VendorProductsService } from './products/vendor-products.service';

@Module({
  controllers: [ProductsController, VendorProductsController, CartController, OrdersController, AdminOrdersController],
  providers: [ProductsService, VendorProductsService, CartService, OrdersService, AdminOrdersService, PricingService],
  exports: [PricingService],
})
export class CommerceModule {}
