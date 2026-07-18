import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReviewStatus } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  CreateReviewDto,
  FlagReviewDto,
  RespondReviewDto,
} from './dto/review.dto';
import { ReviewsService } from './reviews.service';

const ipOf = (req: Request) => req.ip ?? undefined;

@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get('products/:productId/reviews')
  @ApiOperation({ summary: 'Published reviews + rating summary for a product' })
  forProduct(@Param('productId') productId: string) {
    return this.reviews.forProduct(productId);
  }

  @ApiBearerAuth()
  @Post('reviews')
  @ApiOperation({ summary: 'Review a purchased product' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateReviewDto) {
    return this.reviews.create(userId, dto);
  }

  @ApiBearerAuth()
  @Post('vendor/reviews/:id/respond')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.VENDOR)
  @ApiOperation({ summary: 'Vendor replies to a review' })
  respond(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: RespondReviewDto,
  ) {
    return this.reviews.respond(userId, id, dto);
  }

  // ── Admin moderation ──────────────────────────────────────────────────

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('admin/reviews')
  @ApiOperation({ summary: 'Review moderation queue' })
  list(@Query('status') status?: ReviewStatus) {
    return this.reviews.list(status);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('admin/reviews/:id/flag')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flag a review' })
  flag(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() dto: FlagReviewDto,
    @Req() req: Request,
  ) {
    return this.reviews.flag(adminId, id, dto, ipOf(req));
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('admin/reviews/:id/keep')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Keep (re-publish) a review' })
  keep(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.reviews.keep(adminId, id, ipOf(req));
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('admin/reviews/:id/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a review' })
  remove(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.reviews.remove(adminId, id, ipOf(req));
  }
}
