/**
 * What a storage provider has to do.
 *
 * Kept deliberately small so Cloudinary and R2 stay interchangeable behind
 * UPLOAD_DRIVER. Anything provider-specific (transformations, bucket policy,
 * CDN rules) belongs inside the driver, not in this contract.
 */
export interface StoredFile {
  /** Where the file can be fetched from. */
  url: string;
  /** Provider-side identifier, kept so the object can be deleted later. */
  key: string;
  bytes: number;
  mimeType: string;
}

export interface UploadInput {
  buffer: Buffer;
  /** Original filename from the client — used for the extension only. */
  filename: string;
  mimeType: string;
  /** Logical folder, e.g. "kyc" or "products". */
  folder: string;
}

export interface UploadDriver {
  /** Human name, for logs and the health/config surface. */
  readonly name: string;
  /** False when the driver's keys are missing — the endpoint 503s rather than crashing at boot. */
  readonly configured: boolean;
  upload(input: UploadInput): Promise<StoredFile>;
  remove(key: string): Promise<void>;
}
