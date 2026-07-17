import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminPeopleController } from './people.controller';
import { AdminPeopleService } from './people.service';
import { AdminTeamController } from './team.controller';
import { AdminTeamService } from './team.service';

@Module({
  controllers: [AdminController, AdminPeopleController, AdminTeamController],
  providers: [AdminService, AdminPeopleService, AdminTeamService],
})
export class AdminModule {}
