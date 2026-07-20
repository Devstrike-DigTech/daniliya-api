/**
 * Branded HTML shell for every transactional email.
 *
 * Built table-first with inline styles so it renders consistently across email
 * clients (Gmail, Outlook, Apple Mail), which strip <style> blocks and modern
 * CSS. The storefront palette is reused so the mail matches the site rather
 * than looking like an anonymous system message.
 */

const BRAND = '#d4a017'; // gold — matches --color-brand / --color-gold
const INK = '#212121';
const COAL = '#2d2d2d';
const CREAM = '#fdfaf3';
const MUTED = '#6b6b6b';
const BORDER = '#ece4d2';

export interface EmailButton {
  label: string;
  url: string;
}

export interface EmailOptions {
  /** Hidden preview line shown in the inbox list before the body is opened. */
  preheader: string;
  /** Large title inside the card. */
  heading: string;
  /** Optional lead paragraph under the heading. */
  intro?: string;
  /** Optional extra HTML (key/value blocks, item tables, code panels). */
  bodyHtml?: string;
  /** Optional primary call-to-action button. */
  button?: EmailButton;
  /** Optional small print under the body (e.g. "didn't request this?"). */
  footnote?: string;
  /**
   * Absolute URL to the brand emblem (served from the storefront's public
   * folder). Shown beside the wordmark when present; omitted → text-only mark.
   * Must be absolute — email clients can't resolve relative paths.
   */
  logoUrl?: string;
}

/** Escape a string for safe interpolation into email HTML. */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderEmail(o: EmailOptions): string {
  const year = 2026;

  const button = o.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px">
         <tr><td style="border-radius:10px;background:${BRAND}">
           <a href="${esc(o.button.url)}" target="_blank"
              style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:700;color:#1a1206;text-decoration:none;border-radius:10px">
             ${esc(o.button.label)}
           </a>
         </td></tr>
       </table>`
    : '';

  const intro = o.intro
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK}">${o.intro}</p>`
    : '';

  const footnote = o.footnote
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:${MUTED}">${o.footnote}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <title>${esc(o.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all">${esc(o.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

          <!-- Brand bar -->
          <tr>
            <td style="padding:4px 4px 20px">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  ${
                    o.logoUrl
                      ? `<td width="40" align="center" valign="middle"
                            style="width:40px;height:40px;background:#ffffff;border:1px solid ${BORDER};border-radius:20px;padding:4px">
                           <img src="${esc(o.logoUrl)}" width="34" height="34" alt="Daniliya"
                                style="display:block;width:34px;height:34px;border:0"/>
                         </td>
                         <td style="width:10px">&nbsp;</td>`
                      : ''
                  }
                  <td valign="middle">
                    <span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:${INK}">Danili<span style="color:${BRAND}">ya</span></span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border:1px solid ${BORDER};border-radius:16px;overflow:hidden">
              <div style="height:4px;background:${BRAND}"></div>
              <div style="padding:36px 32px">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:800;color:${INK}">${esc(o.heading)}</h1>
                ${intro}
                ${o.bodyHtml ?? ''}
                ${button}
                ${footnote}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 8px 0;text-align:center">
              <p style="margin:0 0 6px;font-size:13px;color:${COAL};font-weight:700">Daniliya</p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED}">
                One brand, infinite possibilities.<br/>
                This is an automated message about your Daniliya activity — please don't reply.
              </p>
              <p style="margin:14px 0 0;font-size:11px;color:${MUTED}">© ${year} Daniliya. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** A shaded key/value list for order details, receipts, etc. */
export function detailRows(rows: [string, string][]): string {
  const body = rows
    .map(
      ([k, v]) =>
        `<tr>
           <td style="padding:6px 0;font-size:14px;color:${MUTED}">${esc(k)}</td>
           <td style="padding:6px 0;font-size:14px;color:${INK};text-align:right;font-weight:600">${esc(v)}</td>
         </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
            style="margin:4px 0 8px;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER}">${body}</table>`;
}

export const emailPalette = { BRAND, INK, COAL, CREAM, MUTED, BORDER };
