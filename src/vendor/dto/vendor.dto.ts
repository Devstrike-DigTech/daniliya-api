import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class MarkShippedDto {
  @ApiProperty({ example: 'GIG Logistics' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  courier!: string;

  @ApiPropertyOptional({ example: 'GIG-4471X2' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  trackingNumber?: string;

  @ApiPropertyOptional({
    description: 'ISO date the buyer should expect delivery',
  })
  @IsOptional()
  @IsDateString()
  estimatedDelivery?: string;
}

/** Vendor self-service profile edit. Every field is optional — only what's sent
 *  is changed. Email is not here: it is the login identity and changing it needs
 *  re-verification. */
export class UpdateVendorProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  productCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;
}
