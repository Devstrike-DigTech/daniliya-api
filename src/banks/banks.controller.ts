import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { BanksService } from './banks.service';
import { CreateBankAccountDto, ResolveAccountDto } from './dto/banks.dto';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('banks')
@Controller()
export class BanksController {
  constructor(private readonly banks: BanksService) {}

  @Public()
  @Get('banks')
  @ApiOperation({
    summary: 'Nigerian bank list (name + code) for payout selectors',
  })
  listBanks() {
    return this.banks.listBanks();
  }

  @ApiBearerAuth()
  @Post('banks/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Name-enquiry — resolve account name from number + bank',
  })
  resolve(@Body() dto: ResolveAccountDto) {
    return this.banks.resolve(dto);
  }

  @ApiBearerAuth()
  @Get('me/bank-accounts')
  @ApiOperation({ summary: 'List my payout accounts' })
  list(@CurrentUser('id') userId: string) {
    return this.banks.list(userId);
  }

  @ApiBearerAuth()
  @Post('me/bank-accounts')
  @ApiOperation({
    summary: 'Add a payout account (name is resolved server-side)',
  })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateBankAccountDto,
    @Req() req: Request,
  ) {
    return this.banks.create(userId, dto, ipOf(req));
  }

  @ApiBearerAuth()
  @Post('me/bank-accounts/:id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make this the default payout account' })
  setDefault(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.banks.setDefault(userId, id, ipOf(req));
  }

  @ApiBearerAuth()
  @Delete('me/bank-accounts/:id')
  @ApiOperation({ summary: 'Remove a payout account' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.banks.remove(userId, id, ipOf(req));
  }
}
