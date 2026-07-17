import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { NIGERIAN_BANKS } from './nigerian-banks';

export interface BankOption {
  name: string;
  code: string;
}

export interface ResolvedAccount {
  accountNumber: string;
  accountName: string;
}

/**
 * Paystack bank list + name-enquiry.
 *
 * Without PAYSTACK_SECRET_KEY (Phase 0.3 pending) this runs in STUB mode: the
 * bank list falls back to a static Nigerian list and resolution returns a
 * deterministic placeholder name so KYC/onboarding are developable. Stub mode
 * is refused in production — resolving a payout account against fake data is a
 * money-losing bug, not a convenience.
 */
@Injectable()
export class PaystackBanksService {
  private readonly logger = new Logger(PaystackBanksService.name);
  private readonly http: AxiosInstance | null;
  private readonly isProd: boolean;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    this.isProd = this.config.get<string>('NODE_ENV') === 'production';
    const usable = key && !key.startsWith('change-me') && key.startsWith('sk_');

    this.http = usable
      ? axios.create({
          baseURL: 'https://api.paystack.co',
          headers: { Authorization: `Bearer ${key}` },
          timeout: 10_000,
        })
      : null;

    if (!this.http) {
      this.logger.warn(
        'PAYSTACK_SECRET_KEY not set — bank list/resolve running in STUB mode.',
      );
    }
  }

  get isStub(): boolean {
    return this.http === null;
  }

  async listBanks(): Promise<BankOption[]> {
    if (!this.http) {
      this.assertStubAllowed();
      return NIGERIAN_BANKS;
    }

    try {
      const { data } = await this.http.get('/bank', {
        params: { country: 'nigeria', perPage: 100 },
      });
      return (data.data as Array<{ name: string; code: string }>).map((b) => ({
        name: b.name,
        code: b.code,
      }));
    } catch (err) {
      this.logger.error('Paystack bank list failed', err as Error);
      throw new ServiceUnavailableException('Could not load banks right now');
    }
  }

  async resolveAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<ResolvedAccount | null> {
    if (!this.http) {
      this.assertStubAllowed();
      return { accountNumber, accountName: 'JANE O. WINSLET' };
    }

    try {
      const { data } = await this.http.get('/bank/resolve', {
        params: { account_number: accountNumber, bank_code: bankCode },
      });
      return {
        accountNumber: data.data.account_number as string,
        accountName: data.data.account_name as string,
      };
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        const { status, data } = err.response;

        // 401/403 = our key is wrong/unauthorised. That is a configuration
        // fault, NOT a bad account — never report it as "check your number",
        // or users chase a problem that isn't theirs.
        if (status === 401 || status === 403) {
          this.logger.error(
            `Paystack rejected the API key (${status}: ${data?.message}). ` +
              'Set a valid PAYSTACK_SECRET_KEY — account resolution is disabled until then.',
          );
          throw new ServiceUnavailableException(
            'Bank verification is not configured correctly. Please contact support.',
          );
        }

        // Other 4xx = Paystack looked and genuinely could not resolve it.
        if (status < 500) return null;
      }

      this.logger.error('Paystack resolve failed', err as Error);
      throw new ServiceUnavailableException('Could not verify the account right now');
    }
  }

  private assertStubAllowed() {
    if (this.isProd) {
      throw new Error('PAYSTACK_SECRET_KEY is required in production');
    }
  }
}
