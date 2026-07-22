import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { CreateVerticalDto, UpdateVerticalDto } from './dto/vertical.dto';
import { VerticalsService } from './verticals.service';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('admin: services')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/services')
export class AdminVerticalsController {
  constructor(private readonly verticals: VerticalsService) {}

  @Get()
  @ApiOperation({ summary: 'List every service vertical (active or not)' })
  list() {
    return this.verticals.adminList();
  }

  @Post()
  @ApiOperation({ summary: 'Add a bookable service' })
  create(
    @Body() dto: CreateVerticalDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.verticals.create(dto, adminId, ipOf(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a service (name, description, active)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVerticalDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.verticals.update(id, dto, adminId, ipOf(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a service (only if it has no bookings)' })
  remove(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.verticals.remove(id, adminId, ipOf(req));
  }
}
