import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export const GOV_ID_TYPES = [
  'NIN slip',
  "Driver's licence",
  'International passport',
  "Voter's card",
] as const;

export class SubmitKycDto {
  @ApiProperty({ enum: GOV_ID_TYPES, example: 'NIN slip' })
  @IsIn(GOV_ID_TYPES)
  govIdType!: string;

  @ApiProperty({ example: 'https://res.cloudinary.com/…/gov-id.jpg' })
  @IsUrl({}, { message: 'govIdUrl must be an uploaded file URL' })
  govIdUrl!: string;

  @ApiProperty({
    description:
      'Payout account to verify against (from POST /me/bank-accounts)',
  })
  @IsString()
  @IsNotEmpty()
  bankAccountId!: string;
}

export class ReviewKycDto {
  @ApiProperty({ required: false, description: 'Required when rejecting' })
  @IsOptional()
  @IsString()
  reason?: string;
}
