import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_PURPOSES,
  UploadPurpose,
  UploadsService,
} from './uploads.service';

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * Store one file and hand back a URL.
   *
   * Signed in only: everything uploaded here is attached to something a person
   * owns (their ID, their product, their job), and an open endpoint would be a
   * free file host. The multipart limit is the largest any purpose allows; the
   * per-purpose limit is enforced again in the service.
   */
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file (multipart "file" field)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('purpose') purpose?: string,
  ) {
    if (!purpose || !UPLOAD_PURPOSES.includes(purpose as UploadPurpose)) {
      throw new BadRequestException(
        `purpose must be one of: ${UPLOAD_PURPOSES.join(', ')}`,
      );
    }
    return this.uploads.store(file, purpose as UploadPurpose);
  }
}
