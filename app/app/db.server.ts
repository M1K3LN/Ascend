import { PrismaClient } from "@prisma/client";

/**
 * Resolve the runtime connection string. Preference order:
 *   1. DATABASE_URL (our canonical name — Supavisor transaction pooler :6543)
 *   2. POSTGRES_PRISMA_URL (injected by the Vercel × Supabase integration;
 *      already pooled + pgbouncer=true)
 * Either way we enforce pgbouncer=true & connection_limit=1 — mandatory for
 * Prisma on Vercel serverless. Never open unpooled connections at runtime.
 */
function resolveDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("pgbouncer")) url.searchParams.set("pgbouncer", "true");
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "1");
    // With a single pooled connection, cold starts (session-table check +
    // first loader query) can exceed Prisma's default 10s pool wait.
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "30");
    return url.toString();
  } catch {
    return raw;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

const prisma =
  global.prismaGlobal ??
  new PrismaClient(
    // Fall back to schema-configured env resolution if nothing is set so the
    // error message stays Prisma's own.
    resolveDatabaseUrl() ? { datasourceUrl: resolveDatabaseUrl() } : undefined,
  );

if (process.env.NODE_ENV !== "production") global.prismaGlobal = prisma;

export default prisma;
