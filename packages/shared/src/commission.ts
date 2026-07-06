import { assertCents } from "./money.js";

/**
 * Commission structures. Percentages are basis points (1000 bps = 10%) so all
 * math stays in integers; flat commissions are integer cents.
 *
 * TIERED programs key a rate off the ambassador's `tier` field with a
 * required "default" fallback, e.g.:
 *   { default: { percentBps: 1000 }, gold: { percentBps: 1500 }, vip: { flatCents: 2500 } }
 */

export type CommissionType = "PERCENT" | "FLAT" | "TIERED";

export interface TierRate {
  percentBps?: number;
  flatCents?: number;
}

export interface ProgramCommissionConfig {
  commissionType: CommissionType | string;
  /** For PERCENT programs: basis points applied to the order subtotal. */
  percentBps?: number | null;
  /** For FLAT programs: cents per attributed order. */
  flatCents?: number | null;
  /** For TIERED programs: tier name → rate; must contain "default". */
  tiers?: Record<string, TierRate> | null;
}

function applyRate(rate: TierRate, subtotalCents: number): number {
  if (rate.flatCents !== undefined && rate.flatCents !== null) {
    assertCents(rate.flatCents, "flatCents");
    return rate.flatCents;
  }
  const bps = rate.percentBps ?? 0;
  if (!Number.isSafeInteger(bps) || bps < 0) {
    throw new TypeError(`percentBps must be a non-negative integer, got ${bps}`);
  }
  // Round half-up on the true value; integer-only arithmetic.
  return Math.floor((subtotalCents * bps + 5000) / 10000);
}

/**
 * Compute the commission (integer cents, >= 0) for an attributed order.
 * `subtotalCents` should exclude shipping and taxes.
 */
export function computeCommissionCents(
  program: ProgramCommissionConfig,
  subtotalCents: number,
  ambassadorTier?: string | null,
): number {
  assertCents(subtotalCents, "subtotalCents");
  if (subtotalCents < 0) throw new TypeError("subtotalCents must be >= 0");

  switch (program.commissionType) {
    case "PERCENT":
      return applyRate({ percentBps: program.percentBps ?? 0 }, subtotalCents);
    case "FLAT":
      return applyRate({ flatCents: program.flatCents ?? 0 }, subtotalCents);
    case "TIERED": {
      const tiers = program.tiers ?? {};
      const rate = (ambassadorTier && tiers[ambassadorTier]) || tiers["default"];
      if (!rate) throw new TypeError("TIERED program is missing a 'default' tier rate");
      return applyRate(rate, subtotalCents);
    }
    default:
      throw new TypeError(`unknown commission type: ${program.commissionType}`);
  }
}

/**
 * Proportional reversal when part of an order is refunded.
 * Returns a POSITIVE number of cents to reverse, capped so cumulative
 * reversals never exceed the commission originally earned.
 */
export function computeReversalCents(args: {
  commissionEarnedCents: number;
  alreadyReversedCents: number; // positive number
  orderSubtotalCents: number;
  refundedCents: number;
}): number {
  const { commissionEarnedCents, alreadyReversedCents, orderSubtotalCents, refundedCents } = args;
  assertCents(commissionEarnedCents, "commissionEarnedCents");
  assertCents(alreadyReversedCents, "alreadyReversedCents");
  assertCents(orderSubtotalCents, "orderSubtotalCents");
  assertCents(refundedCents, "refundedCents");
  if (orderSubtotalCents <= 0 || refundedCents <= 0 || commissionEarnedCents <= 0) return 0;

  const proportional = Math.floor(
    (commissionEarnedCents * Math.min(refundedCents, orderSubtotalCents) + orderSubtotalCents / 2) /
      orderSubtotalCents,
  );
  const remaining = commissionEarnedCents - alreadyReversedCents;
  return Math.max(0, Math.min(proportional, remaining));
}
