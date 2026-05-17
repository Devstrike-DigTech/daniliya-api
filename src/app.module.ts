import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { HubModule } from './hub/hub.module';
import { CommerceModule } from './commerce/commerce.module';
import { AffiliateModule } from './affiliate/affiliate.module';
import { InfluencerModule } from './influencer/influencer.module';
import { PayoutsModule } from './payouts/payouts.module';
import { AdminModule } from './admin/admin.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { TrackingModule } from './tracking/tracking.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    PrismaModule,
    RedisModule,
    AuthModule,
    HubModule,
    CommerceModule,
    AffiliateModule,
    InfluencerModule,
    PayoutsModule,
    AdminModule,
    WebhooksModule,
    TrackingModule,
  ],
})
export class AppModule {}
