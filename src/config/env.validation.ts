import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Boot-time environment contract.
 *
 * REQUIRED vars are the ones the API cannot run without. Third-party
 * integration keys (Paystack, Resend, Termii, Smile ID, S3…) are OPTIONAL here
 * on purpose — they're added phase by phase as accounts are created, and each
 * integration is responsible for failing loudly when it is actually used
 * without its key. See docs/08-delivery-plan.md.
 */
export class EnvVars {
  // ── Core ──────────────────────────────────────────────────────────────
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  PORT = 4000;

  @IsString()
  @IsNotEmpty()
  CORS_ORIGIN!: string;

  // ── Data ──────────────────────────────────────────────────────────────
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  // ── Auth ──────────────────────────────────────────────────────────────
  @IsString()
  @MinLength(32, {
    message: 'JWT_ACCESS_SECRET must be at least 32 characters',
  })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32, {
    message: 'JWT_REFRESH_SECRET must be at least 32 characters',
  })
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_EXPIRES_IN = '15m';

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_EXPIRES_IN = '7d';

  @IsOptional()
  @IsString()
  ENCRYPTION_KEY?: string;

  // ── Bootstrap ─────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  ADMIN_EMAIL?: string;

  // ── Integrations (added as accounts come online) ───────────────────────
  @IsOptional() @IsString() RESEND_API_KEY?: string;
  @IsOptional() @IsString() RESEND_FROM_EMAIL?: string;
  @IsOptional() @IsString() RESEND_FROM_NAME?: string;
  @IsOptional() @IsString() TERMII_API_KEY?: string;
  @IsOptional() @IsString() TERMII_SENDER_ID?: string;
  @IsOptional() @IsString() PAYSTACK_SECRET_KEY?: string;
  @IsOptional() @IsString() PAYSTACK_PUBLIC_KEY?: string;
  @IsOptional() @IsString() FLUTTERWAVE_SECRET_KEY?: string;
  @IsOptional() @IsString() FLUTTERWAVE_SECRET_HASH?: string;
  @IsOptional() @IsString() SMILE_ID_PARTNER_ID?: string;
  @IsOptional() @IsString() SMILE_ID_API_KEY?: string;
  @IsOptional() @IsString() SMILE_ID_ENVIRONMENT?: string;
  @IsOptional() @IsString() CLOUDINARY_CLOUD_NAME?: string;
  @IsOptional() @IsString() CLOUDINARY_API_KEY?: string;
  @IsOptional() @IsString() CLOUDINARY_API_SECRET?: string;
  // ── File storage ──────────────────────────────────────────────────────
  /** Which provider POST /uploads writes to: "cloudinary" or "r2". */
  @IsOptional() @IsString() UPLOAD_DRIVER?: string;
  @IsOptional() @IsString() R2_ACCOUNT_ID?: string;
  @IsOptional() @IsString() R2_ACCESS_KEY_ID?: string;
  @IsOptional() @IsString() R2_SECRET_ACCESS_KEY?: string;
  @IsOptional() @IsString() R2_BUCKET?: string;
  /** Public base URL for the bucket — R2 has none by default. */
  @IsOptional() @IsString() R2_PUBLIC_BASE_URL?: string;

  @IsOptional() @IsString() AWS_ACCESS_KEY_ID?: string;
  @IsOptional() @IsString() AWS_SECRET_ACCESS_KEY?: string;
  @IsOptional() @IsString() AWS_REGION?: string;
  @IsOptional() @IsString() SENTRY_DSN?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return validated;
}
