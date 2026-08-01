import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudinaryDriver } from './drivers/cloudinary.driver';
import { R2Driver } from './drivers/r2.driver';
import { StoredFile, UploadDriver } from './drivers/upload-driver';

export const UPLOAD_PURPOSES = [
  'kyc',
  'product',
  'booking',
  'campaign',
  'resource',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCS = [...IMAGES, 'application/pdf'];

/**
 * What each kind of upload is allowed to be.
 *
 * Rules live here rather than in the client so a portal cannot widen them, and
 * so the same limits apply however the file arrives.
 */
const RULES: Record<
  UploadPurpose,
  { subfolder: string; mimes: string[]; maxBytes: number }
> = {
  // Identity documents — photo or scan.
  kyc: { subfolder: 'kyc', mimes: DOCS, maxBytes: 10 * 1024 * 1024 },
  // Catalogue imagery.
  product: { subfolder: 'products', mimes: IMAGES, maxBytes: 5 * 1024 * 1024 },
  // Photos of a job, sometimes a spec sheet.
  booking: { subfolder: 'bookings', mimes: DOCS, maxBytes: 10 * 1024 * 1024 },
  // Creator content samples.
  campaign: {
    subfolder: 'campaigns',
    mimes: IMAGES,
    maxBytes: 5 * 1024 * 1024,
  },
  // Affiliate marketing creatives — banners, carousels, 1-pagers.
  resource: {
    subfolder: 'resources',
    mimes: DOCS,
    maxBytes: 10 * 1024 * 1024,
  },
};

/** The largest any purpose allows — the multipart limit is set from this. */
export const MAX_UPLOAD_BYTES = Math.max(
  ...Object.values(RULES).map((r) => r.maxBytes),
);

/**
 * First bytes of each format we accept.
 *
 * A browser sets Content-Type from the file extension, so it is a hint, not a
 * fact — a .exe renamed to .png arrives as image/png. Sniffing the actual
 * header means what we store is what we said we would store.
 */
const MAGIC: { mime: string; test: (b: Buffer) => boolean }[] = [
  {
    mime: 'image/jpeg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    test: (b) =>
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b.subarray(0, 4).toString() === 'RIFF' &&
      b.subarray(8, 12).toString() === 'WEBP',
  },
  {
    mime: 'application/pdf',
    test: (b) => b.subarray(0, 5).toString() === '%PDF-',
  },
];

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly driver: UploadDriver;
  /** Root folder every upload is nested under, segregated per environment. */
  private readonly root: string;

  constructor(
    config: ConfigService,
    cloudinary: CloudinaryDriver,
    r2: R2Driver,
  ) {
    const choice = (
      config.get<string>('UPLOAD_DRIVER') ?? 'cloudinary'
    ).toLowerCase();
    this.driver = choice === 'r2' ? r2 : cloudinary;

    if (choice !== 'r2' && choice !== 'cloudinary') {
      this.logger.warn(
        `UPLOAD_DRIVER="${choice}" is not recognised — falling back to cloudinary. Use "cloudinary" or "r2".`,
      );
    }

    this.root = this.resolveRoot(config);
    this.logger.log(
      `Upload driver: ${this.driver.name} — root folder "${this.root}"${this.driver.configured ? '' : ' (NOT configured — uploads will 503 until its keys are set)'}`,
    );
  }

  /**
   * Where uploads live, kept separate per environment so local/dev/staging/prod
   * never share a bucket path (e.g. "daniliya/prod").
   *
   * UPLOAD_ROOT_FOLDER wins outright if set. Otherwise the root is
   * "<base>/<env>", where the env is taken from UPLOAD_ENV, else derived from
   * NODE_ENV (production → prod, test → test, anything else → local).
   */
  private resolveRoot(config: ConfigService): string {
    const explicit = config.get<string>('UPLOAD_ROOT_FOLDER')?.trim();
    if (explicit) return explicit.replace(/\/+$/, '');

    const base = (config.get<string>('UPLOAD_BASE_FOLDER') ?? 'daniliya').trim();

    let env = config.get<string>('UPLOAD_ENV')?.trim().toLowerCase();
    if (!env) {
      const node = (config.get<string>('NODE_ENV') ?? 'development').toLowerCase();
      env = node === 'production' ? 'prod' : node === 'test' ? 'test' : 'local';
    }
    return `${base}/${env}`;
  }

  /** Surface for /health and diagnostics — never exposes the keys themselves. */
  status() {
    return { driver: this.driver.name, configured: this.driver.configured };
  }

  async store(
    file: Express.Multer.File,
    purpose: UploadPurpose,
  ): Promise<StoredFile & { purpose: UploadPurpose }> {
    const rule = RULES[purpose];
    if (!rule) throw new BadRequestException('Unknown upload purpose');
    if (!file?.buffer?.length)
      throw new BadRequestException('No file was uploaded');

    if (file.size > rule.maxBytes) {
      throw new PayloadTooLargeException(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit for ${purpose} uploads is ${rule.maxBytes / 1024 / 1024}MB.`,
      );
    }

    // Trust the bytes, not the declared type, then check the real type is allowed.
    const sniffed = MAGIC.find((m) => m.test(file.buffer))?.mime;
    if (!sniffed) {
      throw new BadRequestException(
        'That file type is not supported. Upload a JPEG, PNG, WebP or PDF.',
      );
    }
    if (!rule.mimes.includes(sniffed)) {
      throw new BadRequestException(
        `${sniffed} files cannot be used for ${purpose} uploads. Allowed: ${rule.mimes.join(', ')}.`,
      );
    }

    const stored = await this.driver.upload({
      buffer: file.buffer,
      filename: file.originalname || 'upload',
      mimeType: sniffed,
      folder: `${this.root}/${rule.subfolder}`,
    });

    return { ...stored, purpose };
  }

  remove(key: string) {
    return this.driver.remove(key);
  }
}
