import { parseAmbassadorCsv, type AmbassadorCsvRow } from "../csv.js";
import { generateReferralSlug } from "../slug.js";

/** CSV import job — download from storage, parse, dedupe against the DB, insert. */

export interface CsvImportDeps {
  getImportJob(importJobId: string): Promise<{ id: string; merchantId: string; storagePath: string } | null>;
  downloadFile(storagePath: string): Promise<string>;
  /** Emails (lowercase) from `candidates` that already exist for the merchant. */
  findExistingEmails(merchantId: string, candidates: string[]): Promise<Set<string>>;
  createAmbassadors(
    merchantId: string,
    rows: Array<AmbassadorCsvRow & { referralSlug: string }>,
  ): Promise<number>;
  completeImportJob(
    importJobId: string,
    result: {
      totalRows: number;
      created: number;
      duplicatesInFile: number;
      duplicatesInDb: number;
      errors: Array<{ line: number; reason: string }>;
    },
  ): Promise<void>;
  failImportJob(importJobId: string, error: string): Promise<void>;
}

export async function handleCsvImport(deps: CsvImportDeps, importJobId: string): Promise<void> {
  const job = await deps.getImportJob(importJobId);
  if (!job) return; // job deleted — nothing to do

  try {
    const text = await deps.downloadFile(job.storagePath);
    const parsed = parseAmbassadorCsv(text);

    const existing = await deps.findExistingEmails(
      job.merchantId,
      parsed.rows.map((r) => r.email),
    );
    const fresh = parsed.rows.filter((r) => !existing.has(r.email));

    const withSlugs = fresh.map((row) => ({
      ...row,
      referralSlug: row.referralSlug || generateReferralSlug(row.name),
    }));

    const created = withSlugs.length > 0 ? await deps.createAmbassadors(job.merchantId, withSlugs) : 0;

    await deps.completeImportJob(importJobId, {
      totalRows: parsed.rows.length + parsed.errors.length + parsed.duplicateEmailsInFile,
      created,
      duplicatesInFile: parsed.duplicateEmailsInFile,
      duplicatesInDb: parsed.rows.length - fresh.length,
      errors: parsed.errors.slice(0, 100),
    });
  } catch (error) {
    await deps.failImportJob(importJobId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
