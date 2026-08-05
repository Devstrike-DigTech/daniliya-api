import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateInfluencerProfileDto } from './dto/influencer.dto';

type Handles = { instagram?: string; twitter?: string; youtube?: string; tiktok?: string };

@Injectable()
export class InfluencerService {
  constructor(private readonly prisma: PrismaService) {}

  private async orThrow(userId: string) {
    const influencer = await this.prisma.influencerProfile.findUnique({
      where: { userId },
    });
    if (!influencer) throw new ForbiddenException('Not an influencer');
    return influencer;
  }

  /** The creator's editable profile (niche, following, bio, socials) + status. */
  async profile(userId: string) {
    const inf = await this.orThrow(userId);
    return {
      influencerCode: inf.influencerCode,
      niche: inf.niche,
      bio: inf.bio,
      followerCount: inf.followerCount,
      socialHandles: (inf.socialHandles ?? {}) as Handles,
      isApproved: inf.isApproved,
      rejectedReason: inf.rejectedReason,
    };
  }

  /** Update the editable fields. Only provided fields change. */
  async updateProfile(userId: string, dto: UpdateInfluencerProfileDto) {
    const inf = await this.orThrow(userId);

    // Merge social handles onto whatever is stored so a partial edit doesn't
    // wipe the others.
    const current = (inf.socialHandles ?? {}) as Handles;
    const mergedHandles =
      dto.socialHandles !== undefined
        ? {
            instagram: dto.socialHandles.instagram?.trim() || current.instagram || undefined,
            twitter: dto.socialHandles.twitter?.trim() || current.twitter || undefined,
            youtube: dto.socialHandles.youtube?.trim() || current.youtube || undefined,
            tiktok: dto.socialHandles.tiktok?.trim() || current.tiktok || undefined,
          }
        : undefined;

    await this.prisma.influencerProfile.update({
      where: { userId },
      data: {
        ...(dto.niche !== undefined ? { niche: dto.niche.trim() || null } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio.trim() || null } : {}),
        ...(dto.followerCount !== undefined ? { followerCount: dto.followerCount } : {}),
        ...(mergedHandles ? { socialHandles: mergedHandles as Prisma.InputJsonValue } : {}),
      },
    });
    return { updated: true };
  }
}
