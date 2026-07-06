import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env.server";

/**
 * Service-role Supabase client — SERVER ONLY. Used for Storage (CSV imports,
 * media). Data access goes through Prisma; RLS is deny-all and the anon key
 * is never used.
 */

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!cached) {
    cached = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

export const IMPORTS_BUCKET = "imports";

let bucketEnsured = false;

async function ensureImportsBucket(): Promise<void> {
  if (bucketEnsured) return;
  const supabase = supabaseAdmin();
  const { data } = await supabase.storage.getBucket(IMPORTS_BUCKET);
  if (!data) {
    await supabase.storage.createBucket(IMPORTS_BUCKET, { public: false });
  }
  bucketEnsured = true;
}

export async function uploadImportCsv(merchantId: string, filename: string, content: string): Promise<string> {
  await ensureImportsBucket();
  const path = `${merchantId}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error } = await supabaseAdmin()
    .storage.from(IMPORTS_BUCKET)
    .upload(path, new Blob([content], { type: "text/csv" }), { upsert: false });
  if (error) throw new Error(`CSV upload failed: ${error.message}`);
  return path;
}

export async function downloadImportCsv(path: string): Promise<string> {
  const { data, error } = await supabaseAdmin().storage.from(IMPORTS_BUCKET).download(path);
  if (error || !data) throw new Error(`CSV download failed: ${error?.message ?? "no data"}`);
  return data.text();
}
