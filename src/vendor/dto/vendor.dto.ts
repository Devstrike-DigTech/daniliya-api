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
