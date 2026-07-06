-- Ascend 0006: allow ledger DELETE only for explicit tenant erasure (GDPR
-- shop/redact, ambassador deletion). Callers must set the transaction-local
-- flag in the SAME transaction as the delete:
--   select set_config('ascend.allow_ledger_delete', 'on', true);
-- UPDATE remains unconditionally blocked — corrections are new entries.

create or replace function public.prevent_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_setting('ascend.allow_ledger_delete', true) = 'on' then
    return old;
  end if;
  raise exception 'ledger_entries is append-only: % is not allowed. Write a compensating entry instead (or set ascend.allow_ledger_delete for tenant erasure).', tg_op
    using errcode = 'raise_exception';
end;
$$;

-- Pin search_path (Supabase security lint 0011).
alter function public.prevent_ledger_mutation() set search_path = '';
