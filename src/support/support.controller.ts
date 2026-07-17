import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TicketStatus } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { OpenTicketDto, TicketReplyDto } from '../admin/dto/admin.dto';
import { SupportService } from './support.service';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('tickets')
  @ApiOperation({ summary: 'Open a support ticket' })
  open(@CurrentUser('id') userId: string, @Body() dto: OpenTicketDto) {
    return this.support.open(userId, dto);
  }

  @Get('tickets')
  @ApiOperation({ summary: 'My tickets' })
  mine(@CurrentUser('id') userId: string) {
    return this.support.mine(userId);
  }

  @Get('tickets/:ref')
  @ApiOperation({ summary: 'My ticket thread' })
  detail(@CurrentUser('id') userId: string, @Param('ref') ref: string) {
    return this.support.myTicket(userId, ref);
  }

  @Post('tickets/:ref/reply')
  @HttpCode(HttpStatus.OK)
  reply(@CurrentUser('id') userId: string, @Param('ref') ref: string, @Body() dto: TicketReplyDto) {
    return this.support.userReply(userId, ref, dto);
  }
}

@ApiTags('admin: support')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/support/tickets')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Query('status') status?: TicketStatus) {
    return this.support.list(status);
  }

  @Get(':ref')
  detail(@Param('ref') ref: string) {
    return this.support.detail(ref);
  }

  @Post(':ref/reply')
  @HttpCode(HttpStatus.OK)
  reply(@CurrentUser('id') adminId: string, @Param('ref') ref: string, @Body() dto: TicketReplyDto) {
    return this.support.adminReply(adminId, ref, dto);
  }

  @Post(':ref/assign')
  @HttpCode(HttpStatus.OK)
  assign(@CurrentUser('id') adminId: string, @Param('ref') ref: string, @Req() r: Request) {
    return this.support.assign(adminId, ref, ipOf(r));
  }

  @Post(':ref/close')
  @HttpCode(HttpStatus.OK)
  close(@CurrentUser('id') adminId: string, @Param('ref') ref: string, @Req() r: Request) {
    return this.support.close(adminId, ref, ipOf(r));
  }
}
