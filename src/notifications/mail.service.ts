import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * Transactional email via Resend.
 *
 * Until RESEND_API_KEY exists (Phase 0.4), this falls back to logging the
 * message so auth flows are fully developable without the account. The fallback
 * is refused in production — a missing key there is a hard error, not a log.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly isProd: boolean;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.isProd = this.config.get<string>('NODE_ENV') === 'production';

    const email =
      this.config.get<string>('RESEND_FROM_EMAIL') ?? 'no-reply@daniliya.com';
    const name = this.config.get<string>('RESEND_FROM_NAME') ?? 'Daniliya';
    this.from = `${name} <${email}>`;

    if (!this.resend) {
      this.logger.warn(
        'RESEND_API_KEY not set — emails will be logged to the console instead of sent.',
      );
    }
  }

  async sendOtp(to: string, code: string): Promise<void> {
    await this.send({
      to,
      subject: 'Your Daniliya verification code',
      html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
      devPreview: `OTP for ${to}: ${code}`,
    });
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    await this.send({
      to,
      subject: 'Reset your Daniliya password',
      html: `<p>Use this token to reset your password: <strong>${token}</strong></p><p>It expires in 1 hour. If you didn't request this, ignore this email.</p>`,
      devPreview: `Password reset token for ${to}: ${token}`,
    });
  }

  /** Generic notice — used by admin "message user" and invites. */
  async sendNotice(to: string, subject: string, body: string): Promise<void> {
    await this.send({
      to,
      subject,
      html: `<p>${body.replace(/\n/g, '<br/>')}</p>`,
      devPreview: `Notice to ${to} — ${subject}`,
    });
  }

  private async send(opts: {
    to: string;
    subject: string;
    html: string;
    devPreview: string;
  }): Promise<void> {
    if (!this.resend) {
      if (this.isProd) {
        throw new Error('RESEND_API_KEY is required in production');
      }
      this.logger.warn(`[dev-mail] ${opts.devPreview}`);
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });

    if (!error) return;

    // Outside production a bad/placeholder key shouldn't block the flow —
    // surface the reason and fall back to logging so dev can continue.
    if (!this.isProd) {
      this.logger.warn(
        `Resend rejected the send (${error.message}) — falling back to console.`,
      );
      this.logger.warn(`[dev-mail] ${opts.devPreview}`);
      return;
    }

    this.logger.error(`Failed to send "${opts.subject}" to ${opts.to}`, error);
    throw new Error('Failed to send email');
  }
}
