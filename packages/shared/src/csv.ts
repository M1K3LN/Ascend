/**
 * Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF) so the
 * shared package stays dependency-free. Fine for ambassador imports; swap for
 * a streaming parser if files ever exceed the serverless memory budget.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Skip fully-empty trailing rows.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

export interface AmbassadorCsvRow {
  name: string;
  email: string;
  tier?: string;
  tags: string[];
  referralSlug?: string;
  shopifyCustomerId?: string;
}

export interface ParsedAmbassadorCsv {
  rows: AmbassadorCsvRow[];
  /** 1-based line numbers (including header) that were skipped, with reason. */
  errors: Array<{ line: number; reason: string }>;
  duplicateEmailsInFile: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse an ambassador import CSV. Header row required; recognized columns
 * (case-insensitive): name, email, first_name, last_name, tier, tags,
 * referral_slug, shopify_customer_id. Dedupes by email within the file.
 */
export function parseAmbassadorCsv(text: string): ParsedAmbassadorCsv {
  const raw = parseCsv(text);
  if (raw.length === 0) return { rows: [], errors: [{ line: 1, reason: "empty file" }], duplicateEmailsInFile: 0 };

  const header = raw[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  const emailIdx = col("email");
  if (emailIdx === -1) {
    return { rows: [], errors: [{ line: 1, reason: "missing required 'email' column" }], duplicateEmailsInFile: 0 };
  }

  const rows: AmbassadorCsvRow[] = [];
  const errors: ParsedAmbassadorCsv["errors"] = [];
  const seen = new Set<string>();
  let duplicateEmailsInFile = 0;

  for (let r = 1; r < raw.length; r++) {
    const line = r + 1;
    const cells = raw[r];
    const get = (name: string) => {
      const idx = col(name);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };

    const email = get("email").toLowerCase();
    if (!EMAIL_RE.test(email)) {
      errors.push({ line, reason: `invalid email: ${email || "(blank)"}` });
      continue;
    }
    if (seen.has(email)) {
      duplicateEmailsInFile++;
      continue;
    }
    seen.add(email);

    const name = get("name") || [get("first_name"), get("last_name")].filter(Boolean).join(" ") || email.split("@")[0];
    const tags = get("tags")
      .split(/[;|]/)
      .map((t) => t.trim())
      .filter(Boolean);

    rows.push({
      name,
      email,
      tier: get("tier") || undefined,
      tags,
      referralSlug: get("referral_slug") || undefined,
      shopifyCustomerId: get("shopify_customer_id") || undefined,
    });
  }

  return { rows, errors, duplicateEmailsInFile };
}
