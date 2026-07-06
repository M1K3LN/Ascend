import prisma from "../db.server";

export interface AmbassadorBalanceRow {
  ambassadorId: string;
  creditCents: number;
  commissionPendingCents: number;
  lifetimeCommissionCents: number;
}

/**
 * Balances come from the ambassador_balances SQL view (fast segment queries).
 * Falls back to zeros for ambassadors with no ledger entries.
 */
export async function getBalances(ambassadorIds: string[]): Promise<Map<string, AmbassadorBalanceRow>> {
  const map = new Map<string, AmbassadorBalanceRow>();
  if (ambassadorIds.length === 0) return map;

  const rows = await prisma.$queryRaw<
    Array<{
      ambassador_id: string;
      credit_cents: bigint;
      commission_pending_cents: bigint;
      lifetime_commission_cents: bigint;
    }>
  >`
    select ambassador_id, credit_cents, commission_pending_cents, lifetime_commission_cents
    from public.ambassador_balances
    where ambassador_id = any(${ambassadorIds})
  `;

  for (const row of rows) {
    map.set(row.ambassador_id, {
      ambassadorId: row.ambassador_id,
      creditCents: Number(row.credit_cents),
      commissionPendingCents: Number(row.commission_pending_cents),
      lifetimeCommissionCents: Number(row.lifetime_commission_cents),
    });
  }
  for (const id of ambassadorIds) {
    if (!map.has(id)) {
      map.set(id, { ambassadorId: id, creditCents: 0, commissionPendingCents: 0, lifetimeCommissionCents: 0 });
    }
  }
  return map;
}

export async function getMerchantTotals(merchantId: string) {
  const rows = await prisma.$queryRaw<
    Array<{ credit: bigint; commission: bigint }>
  >`
    select
      coalesce(sum(credit_cents), 0)::bigint as credit,
      coalesce(sum(commission_pending_cents), 0)::bigint as commission
    from public.ambassador_balances
    where merchant_id = ${merchantId}
  `;
  return {
    outstandingCreditCents: Number(rows[0]?.credit ?? 0n),
    commissionPayableCents: Number(rows[0]?.commission ?? 0n),
  };
}
