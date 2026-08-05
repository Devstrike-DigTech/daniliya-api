import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { TrackingService } from './tracking.service';

@ApiExcludeController()
@Controller('track')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /**
   * Public share-link entrypoint: records the click and 302-redirects the
   * visitor to the storefront with the code applied for attribution.
   * `?p=<product-slug>` deep-links to a product.
   */
  @Public()
  @Get(':code')
  async go(
    @Param('code') code: string,
    @Query('p') productSlug: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const url = await this.tracking.recordAndResolve(code, {
      productSlug,
      userAgent: req.headers['user-agent'],
    });
    res.redirect(302, url);
  }
}
