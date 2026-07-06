-- Ascend 0003: enforce the append-only ledger at the database level.
-- UPDATE/DELETE on ledger_entries is rejected for every role (triggers fire
-- regardless of RLS bypass). Corrections are written as new entries.

create or replace function public.prevent_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ledger_entries is append-only: % is not allowed. Write a compensating entry instead.', tg_op
    using errcode = 'raise_exception';
end;
$$;

drop trigger if exists ledger_append_only on public.ledger_entries;
create trigger ledger_append_only
  before update or delete on public.ledger_entries
  for each row execute function public.prevent_ledger_mutation();

-- Sign conventions, mirrored from packages/shared/src/ledger.ts.
alter table public.ledger_entries drop constraint if exists ledger_amount_sign_check;
alter table public.ledger_entries add constraint ledger_amount_sign_check check (
  (type in ('COMMISSION_EARNED', 'CREDIT_ISSUED') and amount_cents > 0)
  or (type in ('COMMISSION_REVERSED', 'CREDIT_REDEEMED', 'CREDIT_EXPIRED', 'PAYOUT') and amount_cents <= 0)
);
