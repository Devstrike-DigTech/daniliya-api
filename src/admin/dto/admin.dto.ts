import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminRole, AffiliateTier, TicketPriority } from '@prisma/client';
import { IsEmail, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

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
    description: 'Config key → numeric value, e.g. { "DELIVERY_FEE": "9000.00" }',
    example: { DELIVERY_FEE: '9000.00' },
  })
  @IsObject()
  values!: Record<string, string>;
}
