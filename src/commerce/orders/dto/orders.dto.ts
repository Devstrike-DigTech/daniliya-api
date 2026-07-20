import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FulfilmentMode, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsDateString,
  MaxLength,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ContactDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  phone!: string;
}

export class QuoteDto {
  @ApiProperty({ enum: FulfilmentMode })
  @IsEnum(FulfilmentMode)
  mode!: FulfilmentMode;
}

export class PlaceOrderDto {
  @ApiProperty({ enum: FulfilmentMode })
  @IsEnum(FulfilmentMode)
  mode!: FulfilmentMode;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @ApiProperty({ type: ContactDto })
  @ValidateNested()
  @Type(() => ContactDto)
  contact!: ContactDto;

  @ApiPropertyOptional({ description: 'Required when mode = DELIVERY' })
  @IsOptional()
  @IsObject()
  deliveryAddress?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Affiliate referral code (?ref=)' })
  @IsOptional()
  @IsString()
  affiliateCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  influencerCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  promoCode?: string;
}

/**
 * A guest has no server-side cart, so the line items travel in the request.
 * Only productId and quantity are trusted — the price is always re-read from
 * the database, never taken from the client.
 */
export class GuestItemDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 1, maximum: 99 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  giftWrap?: boolean;
}

export class GuestQuoteDto extends QuoteDto {
  @ApiProperty({ type: [GuestItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GuestItemDto)
  items!: GuestItemDto[];
}

export class PlaceGuestOrderDto extends PlaceOrderDto {
  @ApiProperty({ type: [GuestItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GuestItemDto)
  items!: GuestItemDto[];
}

/** Fulfilment stages an admin can advance an order to (never backwards). */
export const ADVANCEABLE_STATUSES = [
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
] as const;
export type AdvanceableStatus = (typeof ADVANCEABLE_STATUSES)[number];

export class AdvanceOrderDto {
  @ApiProperty({ enum: ADVANCEABLE_STATUSES })
  @IsIn(ADVANCEABLE_STATUSES)
  status!: AdvanceableStatus;

  @ApiPropertyOptional({ description: 'Required when moving to SHIPPED' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  courier?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  trackingNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  estimatedDelivery?: string;
}
