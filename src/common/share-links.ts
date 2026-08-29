/**
 * Shareable referral/campaign links.
 *
 * When TRACKING_BASE_URL is set (the public origin where GET /track/:code is
 * reachable, e.g. https://api.daniliya.com/api/v1), links route through the
 * tracking redirect so every click is logged before landing on the storefront.
 * When it isn't set, they fall back to a direct storefront link that still
 * carries the right attribution param, so attribution keeps working without
 * click counting.
 *
 * The attribution param matters: the storefront treats `ref` as an affiliate
 * code and `promo` as an influencer promo code, and sends each to the matching
 * order field.
 */
const clean = (u?: string | null) => (u ?? '').replace(/\/+$/, '');

export const webBase = () =>
  clean(process.env.WEB_APP_URL) || 'http://localhost:3000';

export const trackingBase = () => clean(process.env.TRACKING_BASE_URL);

export type ShareKind = 'affiliate' | 'influencer';

export function shareLink(
  code: string,
  kind: ShareKind,
  productSlug?: string | null,
): string {
  const tb = trackingBase();
  if (tb) {
    const q = productSlug ? `?p=${encodeURIComponent(productSlug)}` : '';
    return `${tb}/track/${encodeURIComponent(code)}${q}`;
  }
  const param = kind === 'affiliate' ? 'ref' : 'promo';
  const path = productSlug ? `/shop/${encodeURIComponent(productSlug)}` : '/shop';
  return `${webBase()}${path}?${param}=${encodeURIComponent(code)}`;
}
