import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export interface InitResult {
  authorizationUrl: string;
  reference: string;
  simulated: boolean;
}

/**
 * Paystack collection. When PAYSTACK_SECRET_KEY is absent (pre-account), this
 * simulates initialization so checkout is fully developable; the webhook path
 * still works because we can sign a test event with the same env value.
 * Never simulates in production.
 */
@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly secretKey?: string;
  private readonly isProd: boolean;
  private readonly http = axios.create({ baseURL: 'https://api.paystack.co' });

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    // A real Paystack secret is `sk_test_`/`sk_live_` + 40 hex (~48 chars).
    // Anything shorter is a placeholder — don't attempt live calls with it.
    this.secretKey = key && /^sk_(test|live)_[a-z0-9]{32,}$/i.test(key) ? key : undefined;
    this.isProd = this.config.get<string>('NODE_ENV') === 'production';
    if (!this.secretKey) {
      this.logger.warn(
        'PAYSTACK_SECRET_KEY not a valid key — payments run in simulation mode.',
      );
    }
  }

  get configured(): boolean {
    return !!this.secretKey;
  }

  /** Paystack works in kobo integers; we store Decimal naira. */
  private toKobo(amountNaira: Prisma.Decimal): number {
    return Number(amountNaira.times(100).toFixed(0));
  }

  async initializeTransaction(input: {
    email: string;
    amount: Prisma.Decimal;
    reference: string;
    callbackUrl?: string;
  }): Promise<InitResult> {
    if (!this.secretKey) {
      if (this.isProd) throw new Error('PAYSTACK_SECRET_KEY is required in production');
      return {
        authorizationUrl: `https://checkout.simulated/pay/${input.reference}`,
        reference: input.reference,
        simulated: true,
      };
    }

    try {
      const { data } = await this.http.post(
        '/transaction/initialize',
        {
          email: input.email,
          amount: this.toKobo(input.amount),
          reference: input.reference,
          callback_url: input.callbackUrl,
        },
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      );

      return {
        authorizationUrl: data.data.authorization_url,
        reference: data.data.reference,
        simulated: false,
      };
    } catch (err) {
      // Outside production, a rejected key/request shouldn't block checkout —
      // fall back to simulation so the flow stays testable.
      if (this.isProd) throw err;
      const reason = axios.isAxiosError(err)
        ? JSON.stringify(err.response?.data ?? err.message)
        : String(err);
      this.logger.warn(`Paystack init rejected (${reason}) — simulating instead.`);
      return {
        authorizationUrl: `https://checkout.simulated/pay/${input.reference}`,
        reference: input.reference,
        simulated: true,
      };
    }
  }

  /**
   * Initiate a payout transfer. Real Paystack is a two-step (recipient +
   * transfer); simulated when no key so the payout engine is testable. The
   * `idempotencyKey` prevents a retry from double-paying.
   */
  async initiateTransfer(input: {
    amount: Prisma.Decimal;
    reference: string;
    reason: string;
    recipient: { name: string; bankCode: string; accountNumber: string };
    idempotencyKey: string;
  }): Promise<{ reference: string; simulated: boolean }> {
    if (!this.secretKey) {
      if (this.isProd) throw new Error('PAYSTACK_SECRET_KEY is required in production');
      return { reference: input.reference, simulated: true };
    }

    try {
      const auth = { headers: { Authorization: `Bearer ${this.secretKey}` } };
      const recipient = await this.http.post(
        '/transferrecipient',
        {
          type: 'nuban',
          name: input.recipient.name,
          account_number: input.recipient.accountNumber,
          bank_code: input.recipient.bankCode,
          currency: 'NGN',
        },
        auth,
      );
      await this.http.post(
        '/transfer',
        {
          source: 'balance',
          amount: this.toKobo(input.amount),
          recipient: recipient.data.data.recipient_code,
          reference: input.reference,
          reason: input.reason,
        },
        { headers: { ...auth.headers, 'X-Idempotency-Key': input.idempotencyKey } },
      );
      return { reference: input.reference, simulated: false };
    } catch (err) {
      if (this.isProd) throw err;
      this.logger.warn('Paystack transfer rejected — simulating instead.');
      return { reference: input.reference, simulated: true };
    }
  }

  /**
   * Verify Paystack's `x-paystack-signature`: HMAC-SHA512 of the raw body,
   * keyed with the secret key. Uses the same key in simulation so local webhook
   * tests exercise the real verification path.
   */
  verifySignature(rawBody: Buffer, signature?: string): boolean {
    const key = this.secretKey ?? this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!key || !signature) return false;
    const expected = createHmac('sha512', key).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Test helper — sign a payload the way Paystack would (used by local e2e). */
  signForTest(rawBody: Buffer): string {
    const key = this.secretKey ?? this.config.getOrThrow<string>('PAYSTACK_SECRET_KEY');
    return createHmac('sha512', key).update(rawBody).digest('hex');
  }

  newReference(): string {
    return `DNLPAY-${randomBytes(8).toString('hex').toUpperCase()}`;
  }
}
