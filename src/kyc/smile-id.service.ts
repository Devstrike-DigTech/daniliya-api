import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { IDApi, JOB_TYPE } from 'smile-identity-core';

export interface SmileIdSubmission {
  userId: string;
  firstName: string;
  lastName: string;
  /** Smile ID id_type code, e.g. NIN, BVN, DRIVERS_LICENSE, PASSPORT, VOTER_ID. */
  idType: string;
  idNumber: string;
  /** Date of birth as YYYY-MM-DD. */
  dob?: string;
  /** ISO-2 country code; defaults to NG. */
  country?: string;
}

export interface SmileIdResult {
  ref: string;
  /** Whether Smile ID reached an automatic decision. */
  decided: boolean;
  verified: boolean;
  reason?: string;
}

/** The subset of Smile ID's ID-validation response we act on. */
interface IdApiResponse {
  ResultCode?: string;
  ResultText?: string;
  SmileJobID?: string;
  Actions?: { Verify_ID_Number?: string };
}

/**
 * Smile ID identity verification via the ID-validation product (Basic KYC,
 * job type 5): the user's ID number + type + name + DOB are checked against the
 * issuing authority. Synchronous — the decision comes back on the same call.
 *
 * Without SMILE_ID_PARTNER_ID/API_KEY this runs in STUB mode: submissions get a
 * ref and stay PENDING_MANUAL for an admin decision (never auto-approved). Stub
 * mode is refused only when KYC_REQUIRE_PROVIDER=true.
 */
@Injectable()
export class SmileIdService {
  private readonly logger = new Logger(SmileIdService.name);
  private readonly partnerId?: string;
  private readonly apiKey?: string;
  /** 0 = Smile ID sandbox, 1 = production. */
  private readonly sidServer: 0 | 1;
  private readonly requireProvider: boolean;

  constructor(private readonly config: ConfigService) {
    const partnerId = this.config.get<string>('SMILE_ID_PARTNER_ID');
    const apiKey = this.config.get<string>('SMILE_ID_API_KEY');
    const env = (this.config.get<string>('SMILE_ID_ENVIRONMENT') ?? '')
      .toLowerCase();
    this.sidServer = env === 'production' || env === 'live' ? 1 : 0;
    this.requireProvider =
      this.config.get<string>('KYC_REQUIRE_PROVIDER') === 'true';

    // Only reject empty/placeholder values. Note Smile ID partner IDs are just
    // 4 digits, so there is no minimum-length guard beyond non-empty.
    const usable = (v?: string) =>
      !!v && !v.startsWith('change-me') && v.trim().length > 0;
    this.partnerId = usable(partnerId) ? partnerId : undefined;
    this.apiKey = usable(apiKey) ? apiKey : undefined;

    if (this.isStub) {
      this.logger.warn(
        'SMILE_ID credentials not set — KYC running in STUB mode (submissions await manual review).',
      );
    } else {
      this.logger.log(
        `Smile ID configured (${this.sidServer === 1 ? 'production' : 'sandbox'}).`,
      );
    }
  }

  get isStub(): boolean {
    return !this.partnerId || !this.apiKey;
  }

  async submit(input: SmileIdSubmission): Promise<SmileIdResult> {
    if (this.isStub) {
      if (this.requireProvider) {
        throw new ServiceUnavailableException(
          'Identity verification is temporarily unavailable. Please try again later.',
        );
      }
      this.logger.warn(
        `[stub-kyc] submission for user ${input.userId} → manual review`,
      );
      return {
        ref: `stub_${randomUUID()}`,
        decided: false,
        verified: false,
        reason: 'Awaiting manual review (Smile ID not configured)',
      };
    }

    const jobId = `kyc_${randomUUID()}`;
    const connection = new IDApi(
      this.partnerId as string,
      this.apiKey as string,
      this.sidServer,
    );

    try {
      const result = await connection.submit_job<IdApiResponse>(
        { user_id: input.userId, job_id: jobId, job_type: JOB_TYPE.BASIC_KYC },
        {
          country: input.country ?? 'NG',
          id_type: input.idType,
          id_number: input.idNumber,
          first_name: input.firstName,
          last_name: input.lastName,
          ...(input.dob ? { dob: input.dob } : {}),
        },
      );

      const ref = result.SmileJobID ?? jobId;
      const verdict = result.Actions?.Verify_ID_Number;

      if (verdict === 'Verified') {
        return { ref, decided: true, verified: true };
      }
      if (verdict === 'Not Verified') {
        return {
          ref,
          decided: true,
          verified: false,
          reason: result.ResultText ?? 'ID could not be verified',
        };
      }
      // Issuer unavailable / provisional — leave for manual review rather than
      // reject a possibly-valid ID on a transient authority outage.
      this.logger.warn(
        `Smile ID inconclusive for ${input.userId}: ${verdict ?? result.ResultText}`,
      );
      return {
        ref,
        decided: false,
        verified: false,
        reason: result.ResultText ?? 'Awaiting manual review',
      };
    } catch (err) {
      // A provider/network failure must not lose the submission — record it as
      // pending for manual review instead of 500-ing the onboarding.
      this.logger.error(
        `Smile ID submission failed for ${input.userId}`,
        err instanceof Error ? err.stack : String(err),
      );
      return {
        ref: `err_${randomUUID()}`,
        decided: false,
        verified: false,
        reason: 'Verification service error — queued for manual review',
      };
    }
  }
}
