import { Module } from '@nestjs/common';
import { CloudinaryDriver } from './drivers/cloudinary.driver';
import { R2Driver } from './drivers/r2.driver';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * Both drivers are constructed; UploadsService picks one from UPLOAD_DRIVER.
 * Constructing the unused one is harmless — neither opens a connection until a
 * file is actually uploaded, and both report `configured` without their keys.
 */
@Module({
  controllers: [UploadsController],
  providers: [UploadsService, CloudinaryDriver, R2Driver],
  exports: [UploadsService],
})
export class UploadsModule {}
