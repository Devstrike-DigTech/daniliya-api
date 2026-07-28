import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AdminRole,
  AffiliateTier,
  CommissionMode,
  ProductVariantType,
  TicketPriority,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** One buyable size/option row on a product (name + price + optional stock). */
export class ProductVariantInputDto {
  @ApiProperty({ description: 'e.g. "XL", "2m x 3m", "500g"' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity?: number;
}

export class ChangeTierDto {
  @ApiProperty({ enum: AffiliateTier })
  @IsEnum(AffiliateTier)
  tier!: AffiliateTier;
}

export class RejectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class MessageUserDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}

export class RejectProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * Admin-authored product. `vendorId` omitted/null makes it a platform-owned
 * product (Product.vendorId is nullable); otherwise it is attributed to that
 * vendor. `publish` sends it live immediately (ACTIVE) versus saved as a DRAFT.
 */
export class AdminCreateProductDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({
    description: 'Custom URL slug (e.g. "builders-handbook"). Auto-generated from the title if omitted.',
  })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Sale price in naira. Required for single-price products; ' +
      'omit when the product has sizes (price is derived from the sizes).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Omit when the product has sizes.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Attribute to a vendor; omit for platform' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsUUID()
  vendorId?: string | null;

  @ApiPropertyOptional({ description: 'Affiliate commission %, 0–100' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionRate?: number;

  @ApiPropertyOptional({
    enum: ProductVariantType,
    description: 'Set when the product has sizes; null/omit for single-price',
  })
  @IsOptional()
  @IsEnum(ProductVariantType)
  variantType?: ProductVariantType | null;

  @ApiPropertyOptional({ type: [ProductVariantInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantInputDto)
  variants?: ProductVariantInputDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  affiliateEligible?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  influencerEligible?: boolean;

  @ApiPropertyOptional({ enum: CommissionMode, default: CommissionMode.INCLUSIVE })
  @IsOptional()
  @IsEnum(CommissionMode)
  commissionMode?: CommissionMode;

  @ApiPropertyOptional({ default: true, description: 'Publish live vs save as draft' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsUrl({}, { each: true })
  imageUrls?: string[];
}

export class AdminUpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Reassign vendor; null makes it platform-owned' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsUUID()
  vendorId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionRate?: number;

  @ApiPropertyOptional({ enum: ProductVariantType, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(ProductVariantType)
  variantType?: ProductVariantType | null;

  @ApiPropertyOptional({ type: [ProductVariantInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantInputDto)
  variants?: ProductVariantInputDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  affiliateEligible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  influencerEligible?: boolean;

  @ApiPropertyOptional({ enum: CommissionMode })
  @IsOptional()
  @IsEnum(CommissionMode)
  commissionMode?: CommissionMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsUrl({}, { each: true })
  imageUrls?: string[];
}

export class InviteTeammateDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiProperty({ enum: AdminRole })
  @IsEnum(AdminRole)
  role!: AdminRole;
}

export class ChangeRoleDto {
  @ApiProperty({ enum: AdminRole })
  @IsEnum(AdminRole)
  role!: AdminRole;
}

export class OpenTicketDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;
}

export class TicketReplyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}

export class UpdateConfigDto {
  @ApiProperty({
    description:
      'Config key → numeric value, e.g. { "DELIVERY_FEE": "9000.00" }',
    example: { DELIVERY_FEE: '9000.00' },
  })
  @IsObject()
  values!: Record<string, string>;
}
