import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FulfilmentMode, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
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
