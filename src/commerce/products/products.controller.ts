import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { ProductsService } from './products.service';

@ApiTags('catalog')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Browse the public catalogue (active products only)',
  })
  list(@Query() query: CatalogQueryDto) {
    return this.products.list(query);
  }

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'Distinct product categories' })
  categories() {
    return this.products.categories();
  }

  // Static path — must precede ':slug' so it isn't captured as a slug.
  @Public()
  @Get('featured-book')
  @ApiOperation({ summary: 'The storefront Builder\'s Handbook (any status)' })
  featuredBook() {
    return this.products.featuredBook();
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Product detail by slug' })
  bySlug(@Param('slug') slug: string) {
    return this.products.bySlug(slug);
  }
}
