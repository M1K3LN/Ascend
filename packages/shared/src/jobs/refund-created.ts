import { computeReversalCents } from "../commission.js";
import { decimalToCents } from "../money.js";
import { validateLedgerEntry } from "../ledger.js";

/**
 * refunds/create handler — writes a proportional COMMISSION_REVERSED entry.
 * Idempotent via the ledger's unique idempotencyKey (`reversal:<refundId>`).
 */

export interface RefundPayloadLike {
  id: number | string;
  order_id: number | string;
  refund_line_items?: Array<{ subtotal?: string | number; quantity?: number }>;
  transactions?: Array<{ amount?: string | number; kind?: string; status?: string }>;
}

export interface RefundDeps {
  /** Referral for the refunded order, or null if the order wasn't attributed. */
  findReferralByOrderId(orderId: string): Promise<{
    id: string;
    ambassadorId: string;
    commissionCents: number;
    orderSubtotalCents: number;
    currency: string;
    status: string;
  } | null>;
  /** Sum of prior reversal amounts for this referral (negative cents). */
  sumReversedCents(referralId: string, orderId: string): Promise<number>;
  /** Write the reversal entry + update referral status, transactionally.
   *  Must be a no-op if idempotencyKey already exists. */
  writeReversal(input: {
    referralId: string;
    ambassadorId: string;
    amountCents: number; // negative
    currency: string;
    orderId: string;
    idempotencyKey: string;
    memo: string;
    fullyReversed: boolean;
  }): Promise<{ created: boolean }>;
}

export type RefundResult =
  | { outcome: "no_referral" }
  | { outcome: "nothing_to_reverse" }
  | { outcome: "duplicate" }
  | { outcome: "reversed"; amountCents: number; fullyReversed: boolean };

/** Refunded merchandise value in cents (excludes shipping refunds when line items are present). */
export function refundedAmountCents(refund: RefundPayloadLike): number {
  const lineItemTotal = (refund.refund_line_items ?? []).reduce(
    (sum, li) => sum + decimalToCents(li.subtotal ?? 0),
    0,
  );
  if (lineItemTotal > 0) return lineItemTotal;
  return (refund.transactions ?? [])
    .filter((t) => t.kind === "refund" && (t.status === "success" || t.status === undefined))
    .reduce((sum, t) => sum + decimalToCents(t.amount ?? 0), 0);
}

export async function handleRefundCreated(deps: RefundDeps, refund: RefundPayloadLike): Promise<RefundResult> {
  const orderId = String(refund.order_id);
  const referral = await deps.findReferralByOrderId(orderId);
  if (!referral) return { outcome: "no_referral" };
  if (referral.status === "REVERSED") return { outcome: "nothing_to_reverse" };

  const refundedCents = refundedAmountCents(refund);
  const alreadyReversedCents = -(await deps.sumReversedCents(referral.id, orderId));
  const reversalCents = computeReversalCents({
    commissionEarnedCents: referral.commissionCents,
    alreadyReversedCents,
    orderSubtotalCents: referral.orderSubtotalCents,
    refundedCents,
  });
  if (reversalCents <= 0) return { outcome: "nothing_to_reverse" };

  const entry = {
    referralId: referral.id,
    ambassadorId: referral.ambassadorId,
    amountCents: -reversalCents,
    currency: referral.currency,
    orderId,
    idempotencyKey: `reversal:${refund.id}`,
    memo: `Reversal for refund ${refund.id} on order ${orderId}`,
    fullyReversed: alreadyReversedCents + reversalCents >= referral.commissionCents,
  };
  validateLedgerEntry({ type: "COMMISSION_REVERSED", amountCents: entry.amountCents });

  const { created } = await deps.writeReversal(entry);
  if (!created) return { outcome: "duplicate" };
  return { outcome: "reversed", amountCents: -reversalCents, fullyReversed: entry.fullyReversed };
}
