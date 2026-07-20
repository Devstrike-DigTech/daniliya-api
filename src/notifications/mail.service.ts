import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  detailRows,
  emailPalette,
  esc,
  renderEmail,
  type EmailOptions,
} from './email-layout';

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
      html: this.branded({
        preheader: `Your verification code is ${code}`,
        heading: 'Verify your email',
        intro: 'Enter this code to confirm your email address and continue.',
        bodyHtml: this.codePanel(code),
        footnote:
          "This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.",
      }),
      devPreview: `OTP for ${to}: ${code}`,
    });
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    await this.send({
      to,
      subject: 'Reset your Daniliya password',
      html: this.branded({
        preheader: 'Use the code below to reset your Daniliya password',
        heading: 'Reset your password',
        intro:
          'Use the code below to set a new password. It expires in 1 hour.',
        bodyHtml: this.codePanel(token),
        footnote:
          "If you didn't ask to reset your password, ignore this email — your account is unchanged.",
      }),
      devPreview: `Password reset token for ${to}: ${token}`,
    });
  }

  /** Generic notice — used by admin "message user" and invites. */
  async sendNotice(to: string, subject: string, body: string): Promise<void> {
    const paragraphs = body
      .split(/\n{2,}/)
      .map(
        (p) =>
          `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${emailPalette.INK}">${esc(
            p,
          ).replace(/\n/g, '<br/>')}</p>`,
      )
      .join('');
    await this.send({
      to,
      subject,
      html: this.branded({
        preheader: subject,
        heading: subject,
        bodyHtml: paragraphs,
      }),
      devPreview: `Notice to ${to} — ${subject}`,
    });
  }

  /** A large, monospaced panel for a one-time code or reset token. */
  private codePanel(value: string): string {
    return `<div style="margin:8px 0 4px;padding:18px;text-align:center;background:${emailPalette.CREAM};border:1px solid ${emailPalette.BORDER};border-radius:12px">
      <span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:26px;font-weight:700;letter-spacing:3px;color:${emailPalette.INK}">${esc(
        value,
      )}</span>
    </div>`;
  }

  /** Sent once an order is confirmed (POD placement or a successful card charge). */
  async sendOrderConfirmation(
    to: string,
    order: {
      ref: string;
      total: string | number;
      paymentMethod: string;
      fulfilmentMode: string;
      items: { title: string; quantity: number }[];
    },
  ): Promise<void> {
    const pickup = order.fulfilmentMode === 'PICKUP';
    const pay =
      order.paymentMethod === 'PAY_ON_DELIVERY'
        ? 'Pay on delivery'
        : 'Paid online';

    const itemRows = order.items
      .map(
        (i) =>
          `<tr>
             <td style="padding:8px 0;font-size:14px;color:${emailPalette.INK};border-bottom:1px solid ${emailPalette.BORDER}">${esc(
               i.title,
             )}</td>
             <td style="padding:8px 0;font-size:14px;color:${emailPalette.MUTED};text-align:right;border-bottom:1px solid ${emailPalette.BORDER}">×${i.quantity}</td>
           </tr>`,
      )
      .join('');

    const body =
      detailRows([
        ['Reference', order.ref],
        ['Fulfilment', pickup ? 'Store pickup' : 'Delivery'],
        ['Payment', pay],
      ]) +
      `<p style="margin:20px 0 6px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:${emailPalette.MUTED}">Your items</p>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">
         <tr>
           <td style="font-size:15px;font-weight:800;color:${emailPalette.INK}">Total</td>
           <td style="font-size:15px;font-weight:800;color:${emailPalette.INK};text-align:right">${this.naira(
             order.total,
           )}</td>
         </tr>
       </table>`;

    await this.send({
      to,
      subject: `Your Daniliya order ${order.ref} is confirmed`,
      html: this.branded({
        preheader: `Order ${order.ref} confirmed — ${this.naira(order.total)}`,
        heading: 'Your order is confirmed',
        intro: "Thanks for your order — we've received it and it's now being prepared.",
        bodyHtml: body,
        button: { label: 'Track your order', url: this.trackUrl(order.ref) },
        footnote: 'You can follow your order live from the link above at any time.',
      }),
      devPreview: `Order confirmation ${order.ref} → ${to} (${this.naira(order.total)})`,
    });
  }

  /**
   * Sent when an order moves along the fulfilment ladder (packed, shipped,
   * delivered, completed) or is cancelled/refunded. Statuses we don't announce
   * to the buyer (e.g. CONFIRMED, which the confirmation email already covers)
   * are silently skipped.
   */
  async sendOrderStatusUpdate(
    to: string,
    order: {
      ref: string;
      status: string;
      fulfilmentMode: string;
      courier?: string | null;
      trackingNumber?: string | null;
    },
  ): Promise<void> {
    const pickup = order.fulfilmentMode === 'PICKUP';
    const copy: Record<string, { subject: string; line: string }> = {
      PROCESSING: {
        subject: `Your order ${order.ref} is being packed`,
        line: `We're preparing your order for ${pickup ? 'pickup' : 'dispatch'}.`,
      },
      SHIPPED: pickup
        ? {
            subject: `Your order ${order.ref} is ready for pickup`,
            line: 'Your order is ready to collect from our store.',
          }
        : {
            subject: `Your order ${order.ref} has shipped`,
            line: 'Good news — your order is on its way.',
          },
      DELIVERED: pickup
        ? {
            subject: `Your order ${order.ref} was collected`,
            line: 'Thanks for collecting your order. We hope you love it.',
          }
        : {
            subject: `Your order ${order.ref} was delivered`,
            line: 'Your order has been delivered. We hope you love it.',
          },
      COMPLETED: {
        subject: `Your order ${order.ref} is complete`,
        line: 'Your order is complete. Thank you for shopping with Daniliya.',
      },
      CANCELLED: {
        subject: `Your order ${order.ref} was cancelled`,
        line: 'Your order has been cancelled. Any payment made is being reversed.',
      },
      REFUNDED: {
        subject: `Your order ${order.ref} was refunded`,
        line: 'Your order has been refunded to your original payment method.',
      },
    };

    const c = copy[order.status];
    if (!c) return;

    const courierBlock =
      order.status === 'SHIPPED' && !pickup && order.courier
        ? detailRows(
            [
              ['Courier', order.courier] as [string, string],
              ...(order.trackingNumber
                ? ([['Tracking number', order.trackingNumber]] as [
                    string,
                    string,
                  ][])
                : []),
            ].filter(Boolean) as [string, string][],
          )
        : '';

    await this.send({
      to,
      subject: c.subject,
      html: this.branded({
        preheader: c.subject,
        heading: c.subject.replace(`Your order ${order.ref} `, 'Your order ')
          .replace(/^./, (m) => m.toUpperCase()),
        intro: c.line,
        bodyHtml: detailRows([['Order', order.ref]]) + courierBlock,
        button: { label: 'Track your order', url: this.trackUrl(order.ref) },
      }),
      devPreview: `Order ${order.ref} → ${order.status} → ${to}`,
    });
  }

  /** ₦ figure for email bodies — mirrors the storefront's formatting. */
  private naira(v: string | number): string {
    return `₦${Number(v).toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
  }

  private webBase(): string {
    return (
      this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
  }

  private trackUrl(ref: string): string {
    return `${this.webBase()}/order/track?ref=${encodeURIComponent(ref)}`;
  }

  /**
   * Absolute URL to the brand emblem the email header shows. Defaults to the
   * storefront's public asset; EMAIL_LOGO_URL overrides it if the logo is
   * hosted elsewhere (CDN, marketing site).
   */
  private logoUrl(): string {
    return (
      this.config.get<string>('EMAIL_LOGO_URL') ??
      `${this.webBase()}/images/brand/emblem.png`
    );
  }

  /** renderEmail with the brand logo injected, so every email carries it. */
  private branded(opts: Omit<EmailOptions, 'logoUrl'>): string {
    return renderEmail({ ...opts, logoUrl: this.logoUrl() });
  }

  /**
   * Who order emails go to: the contact email the buyer entered at checkout,
   * falling back to their account email. Returns null when neither is usable so
   * callers can skip the send rather than throw.
   */
  static recipientFor(
    contact: unknown,
    fallback?: string | null,
  ): string | null {
    if (contact && typeof contact === 'object' && !Array.isArray(contact)) {
      const e = (contact as Record<string, unknown>).email;
      if (typeof e === 'string' && e.includes('@')) return e;
    }
    return fallback && fallback.includes('@') ? fallback : null;
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
