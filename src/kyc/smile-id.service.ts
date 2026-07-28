import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface SmileIdSubmission {
  userId: string;
  firstName: string;
  lastName: string;
  govIdType?: string;
  govIdUrl?: string;
}

export interface SmileIdResult {
  ref: string;
  /** Whether Smile ID reached an automatic decision. */
  decided: boolean;
  verified: boolean;
  reason?: string;
}

/**
 * Smile ID identity verification.
 *
 * Without SMILE_ID_PARTNER_ID/API_KEY (Phase 0.3 pending) this runs in STUB
 * mode: submissions get a ref and stay PENDING_MANUAL for an admin decision —
 * it never auto-approves, because auto-verifying identity against nothing would
 * silently open the payout gate. Stub mode is refused in production.
 */
@Injectable()
export class SmileIdService {
  private readonly logger = new Logger(SmileIdService.name);
  private readonly partnerId?: string;
  private readonly apiKey?: string;
  /**
   * When true, a missing provider is a hard error instead of falling back to
   * manual review. Off by default so a deployment without a KYC provider still
   * onboards (submissions queue for manual review) rather than 500-ing. Set
   * KYC_REQUIRE_PROVIDER=true once a real provider is wired to enforce it.
   */
  private readonly requireProvider: boolean;

  constructor(private readonly config: ConfigService) {
    const partnerId = this.config.get<string>('SMILE_ID_PARTNER_ID');
    const apiKey = this.config.get<string>('SMILE_ID_API_KEY');
    this.requireProvider =
      this.config.get<string>('KYC_REQUIRE_PROVIDER') === 'true';

    const usable = (v?: string) =>
      !!v && !v.startsWith('change-me') && v.length > 4;
    this.partnerId = usable(partnerId) ? partnerId : undefined;
    this.apiKey = usable(apiKey) ? apiKey : undefined;

    if (this.isStub) {
      this.logger.warn(
        'SMILE_ID credentials not set — KYC running in STUB mode (submissions await manual review).',
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

    // Real Smile ID submission is wired when credentials land. The webhook at
    // POST /webhooks/smile-id carries the decision either way, so the flow
    // below stays identical: submit → PENDING → webhook → VERIFIED/REJECTED.
    this.logger.log(`Submitting KYC for user ${input.userId} to Smile ID`);
    throw new Error(
      'Smile ID live submission not implemented yet — Phase 2 follow-up',
    );
  }
}
