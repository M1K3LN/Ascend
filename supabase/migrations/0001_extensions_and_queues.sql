-- Ascend 0001: extensions + pgmq queues.
-- Run AFTER `prisma migrate deploy` (Prisma owns table DDL; these files own
-- extensions, RLS, views, triggers, and cron). All statements are idempotent.

create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pgcrypto;

-- Queues. pgmq.create is safe to re-run, but wrap defensively anyway.
do $$
declare
  q text;
begin
  foreach q in array array['webhooks', 'imports', 'emails', 'discount_sync'] loop
    begin
      perform pgmq.create(q);
    exception when others then
      raise notice 'queue % already exists (%)', q, sqlerrm;
    end;
  end loop;
end $$;
