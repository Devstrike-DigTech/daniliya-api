import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutModel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Min,
} from 'class-validator';

export class CreateCampaignDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brief?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];

  @ApiProperty({
    enum: PayoutModel,
    description: 'FLAT = fixed CPA per conversion; COMMISSION = % of subtotal',
  })
  @IsEnum(PayoutModel)
  payoutModel!: PayoutModel;

  @ApiPropertyOptional({
    description: 'Required when payoutModel = COMMISSION',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  commissionRate?: number;

  @ApiPropertyOptional({
    description:
      'CPA per conversion in naira; required when payoutModel = FLAT',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  flatAmount?: number;

  @ApiProperty()
  @IsDateString()
  startDate!: string;

  @ApiProperty()
  @IsDateString()
  endDate!: string;
}

export class AssignInfluencersDto {
  @ApiProperty({
    type: [String],
    description: 'User IDs of influencers to assign',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  influencerUserIds!: string[];
}

export class SubmitPostDto {
  @ApiProperty({ example: 'https://instagram.com/p/abc' })
  @IsUrl()
  postUrl!: string;

  @ApiPropertyOptional({
    description: 'Confirms the post carries the #ad disclosure',
  })
  @IsOptional()
  hasAdDisclosure?: boolean;
}

export class ReviewSubmissionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
