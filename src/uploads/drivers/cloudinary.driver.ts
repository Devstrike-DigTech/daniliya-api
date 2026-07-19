import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { isRealKey } from './is-real-key';
import { StoredFile, UploadDriver, UploadInput } from './upload-driver';

/**
 * Cloudinary, via its signed REST upload.
 *
 * Deliberately no SDK: the signature is a sha1 of the sorted params plus the
 * API secret, which is a few lines and keeps the dependency surface small.
 * https://cloudinary.com/documentation/upload_images#generating_authentication_signatures
 */
@Injectable()
export class CloudinaryDriver implements UploadDriver {
  readonly name = 'cloudinary';
  private readonly logger = new Logger(CloudinaryDriver.name);

  private readonly cloudName?: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;

  constructor(config: ConfigService) {
    this.cloudName = config.get<string>('CLOUDINARY_CLOUD_NAME') || undefined;
    this.apiKey = config.get<string>('CLOUDINARY_API_KEY') || undefined;
    this.apiSecret = config.get<string>('CLOUDINARY_API_SECRET') || undefined;
  }

  get configured(): boolean {
    // Cloudinary API keys are all digits — a useful extra signal that this is a
    // real credential and not a leftover placeholder.
    return (
      isRealKey(this.cloudName) &&
      isRealKey(this.apiKey) &&
      /^\d{6,}$/.test(this.apiKey.trim()) &&
      isRealKey(this.apiSecret)
    );
  }

  private assertConfigured() {
    if (!this.configured) {
      this.logger.error(
        'CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET are not all set.',
      );
      throw new ServiceUnavailableException(
        'File uploads are not configured. Please contact support.',
      );
    }
  }

  /** sha1 over `key=value` pairs sorted by key, then the API secret appended. */
  private sign(params: Record<string, string>): string {
    const canonical = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return createHash('sha1')
      .update(`${canonical}${this.apiSecret}`)
      .digest('hex');
  }

  async upload(input: UploadInput): Promise<StoredFile> {
    this.assertConfigured();

    const timestamp = Math.floor(Date.now() / 1000).toString();
    // Everything signed must also be sent, and vice versa, or Cloudinary 401s.
    const signed = { folder: input.folder, timestamp };
    const signature = this.sign(signed);

    // A PDF is a "raw" asset to Cloudinary; images go through the image pipeline.
    const resourceType = input.mimeType === 'application/pdf' ? 'raw' : 'image';

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }),
      input.filename,
    );
    form.append('api_key', this.apiKey!);
    form.append('timestamp', timestamp);
    form.append('folder', input.folder);
    form.append('signature', signature);

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${this.cloudName}/${resourceType}/upload`,
      { method: 'POST', body: form },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error(`Cloudinary upload failed (${res.status}): ${detail}`);
      // 401/403 means our credentials are wrong — a configuration fault, not
      // something the person uploading did.
      throw new ServiceUnavailableException(
        res.status === 401 || res.status === 403
          ? 'File uploads are not configured correctly. Please contact support.'
          : 'Could not store that file right now.',
      );
    }

    const body = (await res.json()) as {
      secure_url: string;
      public_id: string;
      bytes: number;
    };

    return {
      url: body.secure_url,
      key: body.public_id,
      bytes: body.bytes,
      mimeType: input.mimeType,
    };
  }

  async remove(key: string): Promise<void> {
    this.assertConfigured();

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.sign({ public_id: key, timestamp });

    const form = new FormData();
    form.append('public_id', key);
    form.append('api_key', this.apiKey!);
    form.append('timestamp', timestamp);
    form.append('signature', signature);

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${this.cloudName}/image/destroy`,
      { method: 'POST', body: form },
    );
    if (!res.ok) {
      this.logger.warn(`Cloudinary delete failed for ${key} (${res.status})`);
    }
  }
}
