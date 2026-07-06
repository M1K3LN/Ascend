-- Ascend 0004: derived balances view for fast segment queries.
-- Balances are never stored — always summed from the append-only ledger.
-- security_invoker keeps the view from bypassing RLS for client roles.

create or replace view public.ambassador_balances
with (security_invoker = true)
as
select
  a.id as ambassador_id,
  a.merchant_id,
  coalesce(sum(l.amount_cents) filter (
    where l.type in ('CREDIT_ISSUED', 'CREDIT_REDEEMED', 'CREDIT_EXPIRED')
  ), 0)::bigint as credit_cents,
  coalesce(sum(l.amount_cents) filter (
    where l.type in ('COMMISSION_EARNED', 'COMMISSION_REVERSED', 'PAYOUT')
  ), 0)::bigint as commission_pending_cents,
  coalesce(sum(l.amount_cents) filter (
    where l.type = 'COMMISSION_EARNED'
  ), 0)::bigint as lifetime_commission_cents
from public.ambassadors a
left join public.ledger_entries l on l.ambassador_id = a.id
group by a.id, a.merchant_id;
