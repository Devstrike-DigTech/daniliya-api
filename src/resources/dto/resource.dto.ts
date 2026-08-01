import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ResourceType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Admin: create a marketing resource. Only the fields relevant to `type` need
 * to be sent — the service enforces which are required (CREATIVE→fileUrl,
 * SCRIPT→body, VIDEO→videoUrl). `productId` omitted → a global resource.
 */
export class CreateResourceDto {
  @ApiProperty({ enum: ResourceType })
  @IsEnum(ResourceType)
  type!: ResourceType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @ApiPropertyOptional({ description: 'Scope to a product; omit for a global resource.' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  // CREATIVE
  @ApiPropertyOptional({ description: 'Stored file URL (from /uploads?purpose=resource).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fileUrl?: string;

  @ApiPropertyOptional({ description: 'e.g. PNG, PDF' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  fileFormat?: string;

  @ApiPropertyOptional({ description: 'e.g. 1080×1920 or 480KB' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  fileMeta?: string;

  // SCRIPT
  @ApiPropertyOptional({ description: 'The copy the affiliate can send.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  // VIDEO
  @ApiPropertyOptional({ description: 'External video link (YouTube/Vimeo/etc).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  videoUrl?: string;

  @ApiPropertyOptional({ description: 'e.g. 6:42' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  duration?: string;

  @ApiPropertyOptional({ description: 'Visible to affiliates. Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

/** Admin: edit a resource. Type is fixed once created. */
export class UpdateResourceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @ApiPropertyOptional({ description: 'Move to a product, or null for global.' })
  @IsOptional()
  @IsUUID()
  productId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fileUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  fileFormat?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  fileMeta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  videoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(12)
  duration?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
