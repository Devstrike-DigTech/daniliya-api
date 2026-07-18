import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class ResolveAccountDto {
  @ApiProperty({ example: '0123456789', description: 'Exactly 10 digits' })
  @Matches(/^\d{10}$/, { message: 'Account number must be exactly 10 digits' })
  accountNumber!: string;

  @ApiProperty({ example: '058', description: 'Bank code from GET /banks' })
  @IsString()
  @IsNotEmpty()
  bankCode!: string;
}

export class CreateBankAccountDto extends ResolveAccountDto {
  @ApiProperty({ required: false, description: 'Make this the payout default' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
