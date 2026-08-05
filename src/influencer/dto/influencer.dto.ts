import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SocialHandlesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  instagram?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  twitter?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  youtube?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tiktok?: string;
}

/** Influencer self-service profile edit. Only provided fields change. */
export class UpdateInfluencerProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  niche?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(600)
  bio?: string;

  @ApiPropertyOptional({ description: 'Total following across all platforms.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  followerCount?: number;

  @ApiPropertyOptional({ type: SocialHandlesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialHandlesDto)
  socialHandles?: SocialHandlesDto;
}
