import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// ── Tutorial steps ──────────────────────────────────────────────────────────

/** Admin: create a tutorial lesson. */
export class CreateTutorialStepDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({ description: 'Lesson body text.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional({ description: 'Optional walkthrough video link.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  videoUrl?: string;

  @ApiPropertyOptional({
    description: 'Publish immediately? Unpublished lessons are hidden from affiliates.',
  })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

/** Admin: edit a tutorial lesson. */
export class UpdateTutorialStepDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  videoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ description: 'Order among lessons (0-based).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

// ── Assessment questions ────────────────────────────────────────────────────

/** Admin: create an assessment question. `correctOption` must be one of `options`. */
export class CreateAssessmentQuestionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  text!: string;

  @ApiProperty({ type: [String], description: 'Answer choices (min 2).' })
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  options!: string[];

  @ApiProperty({ description: 'The correct answer — must match one of options.' })
  @IsString()
  @IsNotEmpty()
  correctOption!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  explanation?: string;

  @ApiPropertyOptional({ description: 'Whether it can appear in attempts. Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Admin: edit an assessment question. */
export class UpdateAssessmentQuestionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  text?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  options?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  correctOption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  explanation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
