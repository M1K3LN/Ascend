/**
 * All monetary values in the system are integer minor units ("cents").
 * Floats never enter money math; Shopify decimal strings are converted at the
 * boundary with `decimalToCents` and only leave as formatted strings.
 */

export function assertCents(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer number of cents, got ${value}`);
  }
}

/** Convert a Shopify decimal string (e.g. "129.95") to integer cents. */
export function decimalToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const str = String(value).trim();
  const negative = str.startsWith("-");
  const [whole, frac = ""] = str.replace(/^-/, "").split(".");
  const fracPadded = (frac + "00").slice(0, 2);
  const cents = parseInt(whole || "0", 10) * 100 + parseInt(fracPadded || "0", 10);
  if (!Number.isSafeInteger(cents)) throw new TypeError(`cannot parse money value: ${value}`);
  return negative ? -cents : cents;
}

export function formatCents(cents: number, currency = "USD", locale = "en-US"): string {
  assertCents(cents);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
