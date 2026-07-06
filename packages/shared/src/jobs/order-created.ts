import { computeCommissionCents, type ProgramCommissionConfig } from "../commission.js";
import { decimalToCents } from "../money.js";
import { resolveAttribution, type AttributionLookups, type AttributionMethod, type OrderPayloadLike } from "../attribution.js";
import { validateLedgerEntry } from "../ledger.js";

/**
 * orders/create handler — pure logic with injected persistence so the
 * attribution pipeline is testable end-to-end without Postgres.
 */

export interface CreateReferralInput {
  ambassadorId: string;
  orderId: string;
  orderName: string | null;
  attributionMethod: AttributionMethod;
  matchedValue: string;
  orderSubtotalCents: number;
  orderTotalCents: number;
  commissionCents: number;
  currency: string;
  autoApprove: boolean;
  /** Ledger entry to write iff commission > 0, in the same transaction. */
  ledgerEntry: {
    ambassadorId: string;
    type: "COMMISSION_EARNED";
    amountCents: number;
    currency: string;
    orderId: string;
    idempotencyKey: string;
    memo: string;
  } | null;
}

export interface OrderCreatedDeps {
  lookups: AttributionLookups;
  getProgram(): Promise<(ProgramCommissionConfig & { autoApproveReferrals?: boolean }) | null>;
  /** Must be transactional and a no-op if a referral for orderId exists. */
  createReferralWithLedger(input: CreateReferralInput): Promise<{ created: boolean }>;
}

export type OrderCreatedResult =
  | { outcome: "no_attribution" }
  | { outcome: "no_program" }
  | { outcome: "duplicate" }
  | { outcome: "attributed"; ambassadorId: string; method: AttributionMethod; commissionCents: number };

export async function handleOrderCreated(
  deps: OrderCreatedDeps,
  order: OrderPayloadLike,
  fallbackCurrency = "USD",
): Promise<OrderCreatedResult> {
  const attribution = await resolveAttribution(order, deps.lookups);
  if (!attribution) return { outcome: "no_attribution" };

  const program = await deps.getProgram();
  if (!program) return { outcome: "no_program" };

  const subtotalCents = decimalToCents(order.subtotal_price ?? order.total_price ?? 0);
  const totalCents = decimalToCents(order.total_price ?? 0);
  const currency = order.currency || fallbackCurrency;
  const commissionCents = computeCommissionCents(program, Math.max(0, subtotalCents), attribution.ambassador.tier);
  const orderId = String(order.id);

  const ledgerEntry =
    commissionCents > 0
      ? {
          ambassadorId: attribution.ambassador.id,
          type: "COMMISSION_EARNED" as const,
          amountCents: commissionCents,
          currency,
          orderId,
          idempotencyKey: `commission:${orderId}`,
          memo: `Commission for order ${order.name ?? orderId} via ${attribution.method.toLowerCase()}`,
        }
      : null;
  if (ledgerEntry) validateLedgerEntry(ledgerEntry);

  const { created } = await deps.createReferralWithLedger({
    ambassadorId: attribution.ambassador.id,
    orderId,
    orderName: order.name ?? null,
    attributionMethod: attribution.method,
    matchedValue: attribution.matchedValue,
    orderSubtotalCents: subtotalCents,
    orderTotalCents: totalCents,
    commissionCents,
    currency,
    autoApprove: program.autoApproveReferrals ?? false,
    ledgerEntry,
  });

  if (!created) return { outcome: "duplicate" };
  return {
    outcome: "attributed",
    ambassadorId: attribution.ambassador.id,
    method: attribution.method,
    commissionCents,
  };
}
