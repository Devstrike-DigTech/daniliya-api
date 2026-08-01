import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './config/env.validation';
import { BootstrapService } from './bootstrap/bootstrap.service';
import { PlatformConfigModule } from './config/platform-config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { BanksModule } from './banks/banks.module';
import { KycModule } from './kyc/kyc.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HubModule } from './hub/hub.module';
import { PaymentsModule } from './payments/payments.module';
import { LedgerModule } from './ledger/ledger.module';
import { CommissionsModule } from './commissions/commissions.module';
import { CommerceModule } from './commerce/commerce.module';
import { ReviewsModule } from './reviews/reviews.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { SupportModule } from './support/support.module';
import { AffiliateModule } from './affiliate/affiliate.module';
import { VendorModule } from './vendor/vendor.module';
import { UploadsModule } from './uploads/uploads.module';
import { InfluencerModule } from './influencer/influencer.module';
import { PayoutsModule } from './payouts/payouts.module';
import { AdminModule } from './admin/admin.module';
import { ResourcesModule } from './resources/resources.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { TrackingModule } from './tracking/tracking.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    // Baseline limit; sensitive auth routes tighten this with @Throttle().
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    RedisModule,
    PlatformConfigModule,
    NotificationsModule,
    AuditModule,
    HealthModule,
    AuthModule,
    BanksModule,
    KycModule,
    OnboardingModule,
    HubModule,
    PaymentsModule,
    LedgerModule,
    CommissionsModule,
    CommerceModule,
    ReviewsModule,
    CampaignsModule,
    SupportModule,
    AffiliateModule,
    VendorModule,
    UploadsModule,
    InfluencerModule,
    PayoutsModule,
    AdminModule,
    ResourcesModule,
    WebhooksModule,
    TrackingModule,
  ],
  providers: [
    BootstrapService,
    // Order matters: authenticate, then authorize, then rate-limit.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
