import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { extname } from 'path';
import { isRealKey } from './is-real-key';
import { StoredFile, UploadDriver, UploadInput } from './upload-driver';

/**
 * Cloudflare R2, over its S3-compatible API.
 *
 * R2 buckets are private by default and have no public URL unless a custom
 * domain or r2.dev subdomain is attached, so R2_PUBLIC_BASE_URL is required to
 * hand back a fetchable link. Without it we would be returning keys the
 * portals cannot render — see the check in `configured`.
 */
@Injectable()
export class R2Driver implements UploadDriver {
  readonly name = 'r2';
  private readonly logger = new Logger(R2Driver.name);

  private readonly bucket?: string;
  private readonly publicBaseUrl?: string;
  private readonly client?: S3Client;

  constructor(config: ConfigService) {
    const accountId = config.get<string>('R2_ACCOUNT_ID') || undefined;
    const accessKeyId = config.get<string>('R2_ACCESS_KEY_ID') || undefined;
    const secretAccessKey =
      config.get<string>('R2_SECRET_ACCESS_KEY') || undefined;

    this.bucket = config.get<string>('R2_BUCKET') || undefined;
    // Trailing slash trimmed so URL joins stay predictable.
    this.publicBaseUrl =
      config.get<string>('R2_PUBLIC_BASE_URL')?.replace(/\/+$/, '') ||
      undefined;

    if (
      isRealKey(accountId) &&
      isRealKey(accessKeyId) &&
      isRealKey(secretAccessKey)
    ) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  get configured(): boolean {
    return Boolean(
      this.client &&
      isRealKey(this.bucket) &&
      isRealKey(this.publicBaseUrl) &&
      /^https?:\/\//.test(this.publicBaseUrl),
    );
  }

  private assertConfigured() {
    if (!this.configured) {
      this.logger.error(
        'R2 needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL.',
      );
      throw new ServiceUnavailableException(
        'File uploads are not configured. Please contact support.',
      );
    }
  }

  async upload(input: UploadInput): Promise<StoredFile> {
    this.assertConfigured();

    // Random name, original extension. Never trust the client's filename as a
    // key: it can collide, carry a path, or be crafted.
    const ext = extname(input.filename).toLowerCase().slice(0, 10);
    const key = `${input.folder}/${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;

    try {
      await this.client!.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: input.buffer,
          ContentType: input.mimeType,
        }),
      );
    } catch (err) {
      this.logger.error('R2 upload failed', err as Error);
      throw new ServiceUnavailableException(
        'Could not store that file right now.',
      );
    }

    return {
      url: `${this.publicBaseUrl}/${key}`,
      key,
      bytes: input.buffer.byteLength,
      mimeType: input.mimeType,
    };
  }

  async remove(key: string): Promise<void> {
    this.assertConfigured();
    try {
      await this.client!.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(
        `R2 delete failed for ${key}: ${(err as Error).message}`,
      );
    }
  }
}
