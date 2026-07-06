const COMBINING_MARKS = /[̀-ͯ]/g;

// Web Crypto (Node 20+ and browsers) so this module stays isomorphic.
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** e.g. "Jane Doe" → "jane-doe-x7k2" — unique enough per merchant; the DB
 * unique constraint is the real guard and callers retry on collision. */
export function generateReferralSlug(name: string): string {
  const base = slugify(name) || "ambassador";
  const suffix = Array.from(randomBytes(2), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${base}-${suffix}`;
}

/** Discount code pattern {FIRSTNAME}{4RANDOM}, e.g. JANE7QK2 (Phase 3 uses this). */
export function generateDiscountCode(firstName: string): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no confusable chars
  const clean =
    firstName
      .normalize("NFKD")
      .replace(COMBINING_MARKS, "")
      .replace(/[^a-zA-Z]/g, "")
      .toUpperCase()
      .slice(0, 12) || "AMB";
  let suffix = "";
  const bytes = randomBytes(4);
  for (let i = 0; i < 4; i++) suffix += alphabet[bytes[i] % alphabet.length];
  return `${clean}${suffix}`;
}
