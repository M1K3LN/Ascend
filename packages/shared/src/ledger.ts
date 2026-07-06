import { assertCents } from "./money.js";

/**
 * The ledger is append-only. Balances are ALWAYS derived by summing entries —
 * never stored as a mutable field. Amounts are signed integer cents; the sign
 * is dictated by the entry type and validated here before an entry is written.
 */

export const LEDGER_TYPES = [
  "COMMISSION_EARNED",
  "COMMISSION_REVERSED",
  "CREDIT_ISSUED",
  "CREDIT_REDEEMED",
  "CREDIT_EXPIRED",
  "PAYOUT",
] as const;

export type LedgerType = (typeof LEDGER_TYPES)[number];

/** +1 → entry amount must be positive; -1 → must be negative or zero. */
const SIGN_BY_TYPE: Record<LedgerType, 1 | -1> = {
  COMMISSION_EARNED: 1,
  COMMISSION_REVERSED: -1,
  CREDIT_ISSUED: 1,
  CREDIT_REDEEMED: -1,
  CREDIT_EXPIRED: -1,
  PAYOUT: -1,
};

/** Types contributing to the ambassador's spendable store-credit balance. */
export const CREDIT_TYPES: readonly LedgerType[] = [
  "CREDIT_ISSUED",
  "CREDIT_REDEEMED",
  "CREDIT_EXPIRED",
];

/** Types contributing to commission owed but not yet paid out. */
export const COMMISSION_TYPES: readonly LedgerType[] = [
  "COMMISSION_EARNED",
  "COMMISSION_REVERSED",
  "PAYOUT",
];

export interface LedgerEntryLike {
  type: LedgerType | string;
  amountCents: number;
}

export interface Balances {
  /** Spendable store credit. */
  creditCents: number;
  /** Commission earned minus reversals minus payouts. */
  commissionPendingCents: number;
  /** Gross commission ever earned (reversals not subtracted). */
  lifetimeCommissionCents: number;
  /** Total paid out (positive number). */
  paidOutCents: number;
}

export function validateLedgerEntry(entry: LedgerEntryLike): void {
  const type = entry.type as LedgerType;
  const sign = SIGN_BY_TYPE[type];
  if (!sign) throw new TypeError(`unknown ledger type: ${entry.type}`);
  assertCents(entry.amountCents, `ledger amount (${type})`);
  if (sign === 1 && entry.amountCents <= 0) {
    throw new TypeError(`${type} entries must have a positive amount, got ${entry.amountCents}`);
  }
  if (sign === -1 && entry.amountCents > 0) {
    throw new TypeError(`${type} entries must have a non-positive amount, got ${entry.amountCents}`);
  }
}

/** Derive balances from raw entries. Mirrors the ambassador_balances SQL view. */
export function computeBalances(entries: LedgerEntryLike[]): Balances {
  let creditCents = 0;
  let commissionPendingCents = 0;
  let lifetimeCommissionCents = 0;
  let paidOutCents = 0;
  for (const entry of entries) {
    assertCents(entry.amountCents);
    const type = entry.type as LedgerType;
    if (CREDIT_TYPES.includes(type)) creditCents += entry.amountCents;
    if (COMMISSION_TYPES.includes(type)) commissionPendingCents += entry.amountCents;
    if (type === "COMMISSION_EARNED") lifetimeCommissionCents += entry.amountCents;
    if (type === "PAYOUT") paidOutCents -= entry.amountCents;
  }
  return { creditCents, commissionPendingCents, lifetimeCommissionCents, paidOutCents };
}
