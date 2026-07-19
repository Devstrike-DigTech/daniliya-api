/**
 * Is this env value a real credential, or the placeholder someone left behind?
 *
 * A presence check is not enough: `.env.example` values like
 * "your-cloud-name" are non-empty strings, so a driver would report itself
 * configured and then fail at upload time with a confusing 401 from the
 * provider. We hit exactly this with the Paystack key earlier, so the same
 * shape of check is applied here.
 */
const PLACEHOLDER = /(your|xxx|changeme|placeholder|todo|example|<|>)/i;

export function isRealKey(value?: string): value is string {
  const v = value?.trim();
  return Boolean(v) && !PLACEHOLDER.test(v!);
}
