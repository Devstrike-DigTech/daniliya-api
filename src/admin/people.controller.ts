import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { ChangeTierDto, MessageUserDto, RejectDto } from './dto/admin.dto';
import { AdminPeopleService } from './people.service';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('admin: people')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminPeopleController {
  constructor(private readonly people: AdminPeopleService) {}

  // Affiliates
  @Get('affiliates')
  affiliates(@Query('q') q?: string) {
    return this.people.affiliates(q);
  }
  @Get('affiliates/:id')
  affiliate(@Param('id') id: string) {
    return this.people.affiliate(id);
  }
  @Post('affiliates/:id/tier')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change affiliate tier' })
  tier(@Param('id') id: string, @Body() dto: ChangeTierDto, @CurrentUser('id') a: string, @Req() r: Request) {
    return this.people.changeTier(id, dto, a, ipOf(r));
  }

  // Influencers
  @Get('influencers')
  influencers(@Query('q') q?: string) {
    return this.people.influencers(q);
  }
  @Get('influencers/:id')
  influencer(@Param('id') id: string) {
    return this.people.influencer(id);
  }
  @Post('influencers/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveInf(@Param('id') id: string, @CurrentUser('id') a: string, @Req() r: Request) {
    return this.people.approveInfluencer(id, a, ipOf(r));
  }
  @Post('influencers/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectInf(@Param('id') id: string, @Body() dto: RejectDto, @CurrentUser('id') a: string, @Req() r: Request) {
    return this.people.rejectInfluencer(id, dto, a, ipOf(r));
  }

  // Vendors
  @Get('vendors')
  vendors(@Query('q') q?: string) {
    return this.people.vendors(q);
  }
  @Get('vendors/:id')
  vendor(@Param('id') id: string) {
    return this.people.vendor(id);
  }
  @Post('vendors/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveVen(@Param('id') id: string, @CurrentUser('id') a: string, @Req() r: Request) {
    return this.people.approveVendor(id, a, ipOf(r));
  }
  @Post('vendors/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectVen(@Param('id') id: string, @Body() dto: RejectDto, @CurrentUser('id') a: string, @Req() r: Request) {
    return this.people.rejectVendor(id, dto, a, ipOf(r));
  }

  // Standing + message (by userId, any role)
  @Post('users/:userId/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@Param('userId') userId: string, @CurrentUser('id') a: string, @Req() r: Request) {
    return this.people.suspend(userId, a, ipOf(r));
  }
  @Post('users/:userId/reinstate')
  @HttpCode(HttpStatus.OK)
  reinstate(@Param('userId') userId: string, @CurrentUser('id') a: string, @Req() r: Request) {
    return this.people.reinstate(userId, a, ipOf(r));
  }
  @Post('users/:userId/message')
  @HttpCode(HttpStatus.OK)
  message(@Param('userId') userId: string, @Body() dto: MessageUserDto, @CurrentUser('id') a: string, @Req() r: Request) {
    return this.people.message(userId, dto, a, ipOf(r));
  }
}
