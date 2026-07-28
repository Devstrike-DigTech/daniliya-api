import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
} from 'class-validator';

/** ID types Smile ID validates for Nigeria — value is the Smile ID id_type code. */
export const ID_TYPES = [
  { code: 'NIN', label: 'National ID (NIN)' },
  { code: 'BVN', label: 'Bank Verification Number (BVN)' },
  { code: 'DRIVERS_LICENSE', label: "Driver's licence" },
  { code: 'PASSPORT', label: 'International passport' },
  { code: 'VOTER_ID', label: "Voter's card" },
] as const;
export const ID_TYPE_CODES = ID_TYPES.map((t) => t.code);

export class SubmitKycDto {
  @ApiProperty({ enum: ID_TYPE_CODES, example: 'NIN' })
  @IsIn(ID_TYPE_CODES)
  idType!: string;

  @ApiProperty({ example: '12345678901', description: 'The ID number to verify' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9]{4,20}$/, {
    message: 'Enter a valid ID number (letters and digits only).',
  })
  idNumber!: string;

  @ApiPropertyOptional({ example: '1996-08-09', description: 'Date of birth (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dob?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/…/gov-id.jpg',
    description: 'Optional supporting document image',
  })
  @IsOptional()
  @IsUrl({}, { message: 'govIdUrl must be an uploaded file URL' })
  govIdUrl?: string;

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
