import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { ChangeRoleDto, InviteTeammateDto } from './dto/admin.dto';
import { AdminTeamService } from './team.service';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('admin: team')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/team')
export class AdminTeamController {
  constructor(private readonly team: AdminTeamService) {}

  @Get()
  @ApiOperation({ summary: 'List team members + roles' })
  list() {
    return this.team.list();
  }

  @Post('invite')
  @ApiOperation({ summary: 'Invite a teammate (superadmin only)' })
  invite(@CurrentUser('id') adminId: string, @Body() dto: InviteTeammateDto, @Req() r: Request) {
    return this.team.invite(adminId, dto, ipOf(r));
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Change a teammate role (superadmin only)' })
  changeRole(@CurrentUser('id') adminId: string, @Param('id') id: string, @Body() dto: ChangeRoleDto, @Req() r: Request) {
    return this.team.changeRole(adminId, id, dto, ipOf(r));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a teammate (superadmin only)' })
  remove(@CurrentUser('id') adminId: string, @Param('id') id: string, @Req() r: Request) {
    return this.team.remove(adminId, id, ipOf(r));
  }
}
