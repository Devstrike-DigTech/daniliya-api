import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role, Roles } from '../../common/decorators/roles.decorator';
import { CreateProductDto, UpdateProductDto } from './dto/vendor-product.dto';
import { VendorProductsService } from './vendor-products.service';

@ApiTags('vendor: products')
@ApiBearerAuth()
@Roles(Role.VENDOR)
@Controller('vendor/products')
export class VendorProductsController {
  constructor(private readonly products: VendorProductsService) {}

  @Get()
  @ApiOperation({ summary: 'My products (all statuses)' })
  list(@CurrentUser('id') userId: string) {
    return this.products.list(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a product (draft)' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateProductDto) {
    return this.products.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a product' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete (or soft-remove if it has sales)' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.products.remove(userId, id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit for review (draft → pending)' })
  submit(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.products.submit(userId, id);
  }
}
