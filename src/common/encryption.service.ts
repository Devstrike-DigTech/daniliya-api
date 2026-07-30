import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * AES-256-GCM field encryption for sensitive PII (e.g. full ID numbers) that
 * must be retrievable by admins for manual review but never sit in the DB in
 * plaintext. The 32-byte key is derived from KYC_ENCRYPTION_KEY, or JWT_SECRET
 * as a fallback so it always works — set KYC_ENCRYPTION_KEY in production to
 * decouple it from the JWT secret. Ciphertext format: iv:tag:data (base64).
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret =
      config.get<string>('KYC_ENCRYPTION_KEY') ??
      config.get<string>('JWT_SECRET') ??
      'daniliya-dev-encryption-secret';
    if (secret === 'daniliya-dev-encryption-secret') {
      this.logger.warn(
        'No KYC_ENCRYPTION_KEY/JWT_SECRET set — encrypting PII with a dev fallback key.',
      );
    }
    this.key = createHash('sha256').update(secret).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      tag.toString('base64'),
      data.toString('base64'),
    ].join(':');
  }

  /** Returns null on any malformed/undecryptable input rather than throwing. */
  decrypt(blob: string | null | undefined): string | null {
    if (!blob) return null;
    try {
      const [iv, tag, data] = blob
        .split(':')
        .map((s) => Buffer.from(s, 'base64'));
      if (!iv || !tag || !data) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      return null;
    }
  }
}
