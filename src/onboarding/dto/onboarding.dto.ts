import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export const SELECTABLE_ROLES = [
  'CUSTOMER',
  'AFFILIATE',
  'INFLUENCER',
  'VENDOR',
] as const;
export type SelectableRole = (typeof SELECTABLE_ROLES)[number];

export class SelectRoleDto {
  @ApiProperty({ enum: SELECTABLE_ROLES, example: 'AFFILIATE' })
  @IsIn(SELECTABLE_ROLES)
  role!: SelectableRole;
}

export class AnswerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @ApiProperty({ description: 'The chosen option text, exactly as served' })
  @IsString()
  @IsNotEmpty()
  selected!: string;
}

export class SubmitAssessmentDto {
  @ApiProperty({ type: [AnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
}

export class InfluencerApplicationDto {
  @ApiProperty({ example: 'Lifestyle & Beauty' })
  @IsString()
  @IsNotEmpty()
  niche!: string;

  @ApiProperty({ example: 25000 })
  @IsInt()
  @Min(0)
  followerCount!: number;

  @ApiProperty({
    example: { instagram: '@ada.builds', tiktok: '@ada' },
    description: 'At least one handle required',
  })
  @IsNotEmpty()
  socialHandles!: Record<string, string>;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contentLinks?: string[];
}

export class VendorApplicationDto {
  @ApiProperty({ example: 'Sparkle & Co.' })
  @IsString()
  @IsNotEmpty()
  businessName!: string;

  @ApiProperty({ example: 'Home & Cleaning' })
  @IsString()
  @IsNotEmpty()
  productCategory!: string;
}
