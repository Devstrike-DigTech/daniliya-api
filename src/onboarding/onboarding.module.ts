import { Module } from '@nestjs/common';
import { AdminOnboardingController } from './admin-onboarding.controller';
import { OnboardingContentService } from './onboarding-content.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [OnboardingController, AdminOnboardingController],
  providers: [OnboardingService, OnboardingContentService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
