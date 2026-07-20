import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminRole, AffiliateTier, TicketPriority } from '@prisma/client';
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
} from 'class-validator';

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Sale price in naira' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity!: number;

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
