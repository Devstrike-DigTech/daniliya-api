import { SetMetadata } from '@nestjs/common';

export enum Role {
  CUSTOMER = 'CUSTOMER',
  AFFILIATE = 'AFFILIATE',
  INFLUENCER = 'INFLUENCER',
  VENDOR = 'VENDOR',
  ADMIN = 'ADMIN',
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
