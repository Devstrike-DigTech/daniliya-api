import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  GuestQuoteDto,
  PlaceGuestOrderDto,
  PlaceOrderDto,
  QuoteDto,
} from './dto/orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Public()
  @Get('orders/track')
  @ApiOperation({ summary: 'Track an order by reference (public)' })
  track(@Query('ref') ref: string) {
    return this.orders.track(ref);
  }

  @ApiBearerAuth()
  @Post('checkout/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compute order totals for the current cart' })
  quote(@CurrentUser('id') userId: string, @Body() dto: QuoteDto) {
    return this.orders.quote(userId, dto);
  }

  @ApiBearerAuth()
  @Post('orders')
  @ApiOperation({ summary: 'Place an order from the cart (Pay Now or POD)' })
  place(
    @CurrentUser('id') userId: string,
    @Body() dto: PlaceOrderDto,
    // The storefront the checkout came from, so Paystack returns the buyer to
    // that same site. A header (not a body field) keeps the storefront and API
    // independently deployable: an API that predates this simply ignores it.
    @Headers('x-return-origin') returnOrigin?: string,
  ) {
    return this.orders.place(userId, dto, returnOrigin);
  }

  @Public()
  @Post('checkout/guest-quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Compute order totals for a browser-held cart (no account)',
  })
  guestQuote(@Body() dto: GuestQuoteDto) {
    return this.orders.guestQuote(dto);
  }

  @Public()
  @Post('orders/guest')
  @ApiOperation({ summary: 'Place an order without an account' })
  placeGuest(
    @Body() dto: PlaceGuestOrderDto,
    @Headers('x-return-origin') returnOrigin?: string,
  ) {
    return this.orders.placeGuest(dto, returnOrigin);
  }

  @ApiBearerAuth()
  @Get('orders')
  @ApiOperation({ summary: 'My orders' })
  list(@CurrentUser('id') userId: string) {
    return this.orders.list(userId);
  }

  @ApiBearerAuth()
  @Get('orders/:ref')
  @ApiOperation({ summary: 'Order detail (owner only)' })
  byRef(@CurrentUser('id') userId: string, @Param('ref') ref: string) {
    return this.orders.byRef(userId, ref);
  }
}
