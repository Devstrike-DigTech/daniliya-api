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
import { CreateResourceDto, UpdateResourceDto } from './dto/resource.dto';
import { ResourcesService } from './resources.service';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('admin: resources')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/resources')
export class AdminResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Get()
  @ApiOperation({ summary: 'List every marketing resource (published or not)' })
  list() {
    return this.resources.adminList();
  }

  @Post()
  @ApiOperation({ summary: 'Add a marketing resource (creative / script / video)' })
  create(
    @Body() dto: CreateResourceDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.resources.create(dto, adminId, ipOf(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a resource' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateResourceDto,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.resources.update(id, dto, adminId, ipOf(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a resource' })
  remove(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    return this.resources.remove(id, adminId, ipOf(req));
  }
}
