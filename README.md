# Ascend — enterprise ambassador marketing for Shopify

An UpPromote alternative for brands with 1,000+ ambassadors. Three headline
differentiators:

1. **Unlimited, deliverable email** — message 1k–50k ambassadors daily from the
   merchant's own domain (SES, warm-up schedules, per-merchant rate limiting).
2. **Live-data personalization** — every number in an email is computed at send
   time from the real ledger + Shopify pricing ("you have $34 in credit — pay
   only $16 for Product X").
3. **One code, multiple discounts** — one ambassador code applying product %,
   order %, and shipping discounts simultaneously via Shopify's Discount
   Function API.

## Stack

- **App**: Remix (`@shopify/shopify-app-remix`), embedded, Polaris UI, TypeScript, deployed to Vercel.
- **Data**: Supabase Postgres + Prisma. Runtime through the Supavisor
  transaction pooler (`:6543`, `pgbouncer=true&connection_limit=1`);
  `DIRECT_URL` (`:5432`) for migrations only. RLS deny-all everywhere;
  server-only service-role access; Shopify tokens AES-256-GCM encrypted.
- **Jobs**: Supabase Queues (pgmq) + Vercel Cron drains (`/api/jobs/drain?queue=…`
  every minute), visibility-timeout retries, dead-letter queue with admin UI.
  pg_cron for recurring scans.
- **Storage**: Supabase Storage (CSV imports).
- **Email (Phase 2)**: AWS SES behind an `EmailProvider` interface.

## Layout

```
app/                    Remix app + API/job routes (Vercel root directory)
packages/shared/        Pure logic: ledger math, commission, attribution, CSV,
                        drain loop, job handlers (dependency-injected) + tests
extensions/             Phase 3: ambassador-discount Discount Function
supabase/migrations/    pgmq queues, RLS deny-all, balances view, append-only
                        ledger trigger, pg_cron schedules
```

## Setup

1. **Supabase**: create a project, then apply schema + platform SQL:
   ```bash
   cp .env.example .env          # fill in values
   npm install
   npm run setup                 # prisma generate + prisma migrate deploy (uses DIRECT_URL)
   # then apply supabase/migrations/*.sql in order (Supabase SQL editor, MCP, or supabase db push)
   npm run seed                  # demo merchant + 1,500 ambassadors
   ```
2. **Shopify**: create an app in the Partner Dashboard, put the client id in
   `shopify.app.toml` + `.env` (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`).
3. **Local dev**: `npm run dev` (Shopify CLI tunnels to a dev store; webhooks
   are registered declaratively from `shopify.app.toml`).
4. **Vercel**: [vercel.com/new](https://vercel.com/new) → import `M1K3LN/Ascend`
   → set **Root Directory = `app`** (leave "Include files outside root
   directory" on — the build needs `packages/shared`). Add all env vars from
   `.env.example` (incl. `CRON_SECRET` — Vercel sends it on cron invocations
   automatically). `app/vercel.json` supplies framework/build settings and the
   per-minute drain crons; the build runs shared build + `prisma generate` +
   Remix build (`prisma migrate deploy` is NOT part of the build — apply
   migrations via Supabase MCP/SQL editor, or run `npm run setup` locally).

   **Hobby plan note**: per-minute crons require Vercel Pro. On Hobby, delete
   the `crons` block from `app/vercel.json` and use the included GitHub
   Actions fallback (`.github/workflows/drain-queues.yml`, every 5 min) by
   setting the `APP_URL` and `CRON_SECRET` repository secrets.

## Invariants (do not break)

- Ledger is **append-only** (DB trigger enforces); money is **integer cents**;
  balances are always derived (`ambassador_balances` view / `computeBalances`).
- Every webhook is HMAC-verified, deduped by delivery id, enqueued, and
  answered in milliseconds; all real work happens in the drain route.
- Every job handler is idempotent (unique idempotency keys / unique order ids);
  pgmq is at-least-once.
- Never open unpooled DB connections from Vercel functions.

## Tests

`npm test` — unit tests for ledger math, commission calc, attribution, CSV,
token crypto, plus an integration test of the attribution pipeline
(enqueue → drain → referral + ledger entry) against in-memory pgmq semantics.
