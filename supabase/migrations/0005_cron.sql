-- Ascend 0005: recurring maintenance via pg_cron.
-- Application-level scans (credit expiry, inactivity flows) are added in
-- Phases 2/4; this file establishes the pattern + housekeeping jobs now.

-- Reset per-merchant email send quotas at midnight UTC (Phase 2 warm-up).
select cron.schedule(
  'ascend-reset-send-quotas',
  '0 0 * * *',
  $$update public.send_quotas set sent_today = 0$$
);

-- Purge pgmq archives older than 14 days so archive tables stay small.
select cron.schedule(
  'ascend-purge-pgmq-archives',
  '30 3 * * *',
  $$
  do $job$
  declare
    q text;
  begin
    foreach q in array array['webhooks', 'imports', 'emails', 'discount_sync'] loop
      execute format('delete from pgmq.a_%I where archived_at < now() - interval ''14 days''', q);
    end loop;
  end
  $job$
  $$
);

-- Drop stale processed webhook-event dedupe rows after 30 days.
select cron.schedule(
  'ascend-purge-webhook-events',
  '45 3 * * *',
  $$delete from public.webhook_events where received_at < now() - interval '30 days' and processed_at is not null$$
);
