import { describe, expect, it } from "vitest";
import { InMemoryQueue } from "./testing/in-memory-queue.js";
import { drainQueue } from "./jobs/drain.js";
import { handleOrderCreated, type CreateReferralInput, type OrderCreatedDeps } from "./jobs/order-created.js";
import { handleRefundCreated, type RefundDeps } from "./jobs/refund-created.js";
import { computeBalances } from "./ledger.js";
import type { JobMessage, WebhookJob } from "./jobs/queue.js";

/**
 * Integration test for the attribution pipeline:
 *   webhook enqueued → drain loop reads batch → orders/create handler →
 *   referral + COMMISSION_EARNED ledger entry → refund → proportional reversal.
 * Uses the production drain loop + handlers with an in-memory queue/store
 * standing in for pgmq/Postgres.
 */

interface LedgerRow {
  ambassadorId: string;
  type: string;
  amountCents: number;
  idempotencyKey: string;
}

class InMemoryStore {
  referrals: Array<CreateReferralInput & { id: string; status: string }> = [];
  ledger: LedgerRow[] = [];
  ambassadors = [
    { id: "amb_jane", tier: "gold", status: "ACTIVE", code: "JANE10", slug: "jane-doe-x7k2", customerId: "900" },
  ];
  program = { commissionType: "PERCENT" as const, percentBps: 1000, autoApproveReferrals: true };

  orderDeps(): OrderCreatedDeps {
    return {
      lookups: {
        findByDiscountCode: async (code) => {
          const a = this.ambassadors.find((x) => x.code === code);
          return a ? { id: a.id, tier: a.tier, status: a.status } : null;
        },
        findByReferralSlug: async (slug) => {
          const a = this.ambassadors.find((x) => x.slug === slug);
          return a ? { id: a.id, tier: a.tier, status: a.status } : null;
        },
        findByShopifyCustomerId: async (customerId) => {
          const a = this.ambassadors.find((x) => x.customerId === customerId);
          return a ? { id: a.id, tier: a.tier, status: a.status } : null;
        },
      },
      getProgram: async () => this.program,
      createReferralWithLedger: async (input) => {
        // Unique (merchant, orderId) — mirror of the DB constraint.
        if (this.referrals.some((r) => r.orderId === input.orderId)) return { created: false };
        this.referrals.push({ ...input, id: `ref_${this.referrals.length + 1}`, status: input.autoApprove ? "APPROVED" : "PENDING" });
        if (input.ledgerEntry) {
          if (this.ledger.some((l) => l.idempotencyKey === input.ledgerEntry!.idempotencyKey)) {
            return { created: false };
          }
          this.ledger.push({
            ambassadorId: input.ledgerEntry.ambassadorId,
            type: input.ledgerEntry.type,
            amountCents: input.ledgerEntry.amountCents,
            idempotencyKey: input.ledgerEntry.idempotencyKey,
          });
        }
        return { created: true };
      },
    };
  }

  refundDeps(): RefundDeps {
    return {
      findReferralByOrderId: async (orderId) => {
        const r = this.referrals.find((x) => x.orderId === orderId);
        return r
          ? {
              id: r.id,
              ambassadorId: r.ambassadorId,
              commissionCents: r.commissionCents,
              orderSubtotalCents: r.orderSubtotalCents,
              currency: r.currency,
              status: r.status,
            }
          : null;
      },
      sumReversedCents: async (referralId, orderId) =>
        this.ledger
          .filter((l) => l.type === "COMMISSION_REVERSED" && l.idempotencyKey.startsWith("reversal:") && this.referrals.find((r) => r.id === referralId)?.orderId === orderId)
          .reduce((s, l) => s + l.amountCents, 0),
      writeReversal: async (input) => {
        if (this.ledger.some((l) => l.idempotencyKey === input.idempotencyKey)) return { created: false };
        this.ledger.push({
          ambassadorId: input.ambassadorId,
          type: "COMMISSION_REVERSED",
          amountCents: input.amountCents,
          idempotencyKey: input.idempotencyKey,
        });
        if (input.fullyReversed) {
          const r = this.referrals.find((x) => x.id === input.referralId);
          if (r) r.status = "REVERSED";
        }
        return { created: true };
      },
    };
  }
}

/** Mirrors the app's job registry: dispatch a webhook message by topic. */
function makeDispatch(store: InMemoryStore) {
  return async (payload: JobMessage) => {
    if (payload.type !== "webhook") throw new Error(`unexpected job type ${payload.type}`);
    const job = payload as WebhookJob;
    switch (job.topic) {
      case "orders/create":
        await handleOrderCreated(store.orderDeps(), job.payload as any);
        return;
      case "refunds/create":
        await handleRefundCreated(store.refundDeps(), job.payload as any);
        return;
      default:
        return; // unhandled topics are acked
    }
  };
}

const orderWebhook = (id: number, extra: Record<string, unknown> = {}): WebhookJob => ({
  type: "webhook",
  webhookId: `wh_${id}_${JSON.stringify(extra).length}`,
  topic: "orders/create",
  shop: "demo.myshopify.com",
  payload: {
    id,
    name: `#${id}`,
    currency: "USD",
    subtotal_price: "200.00",
    total_price: "215.00",
    discount_codes: [{ code: "JANE10" }],
    ...extra,
  },
});

describe("attribution pipeline (enqueue → drain → ledger entry)", () => {
  it("attributes an order by code and writes a commission ledger entry", async () => {
    const queue = new InMemoryQueue();
    const store = new InMemoryStore();

    await queue.send("webhooks", orderWebhook(1001));
    const stats = await drainQueue(queue, "webhooks", makeDispatch(store), { budgetMs: 1000, now: () => queue.now++ });

    expect(stats.processed).toBe(1);
    expect(store.referrals).toHaveLength(1);
    expect(store.referrals[0]).toMatchObject({
      orderId: "1001",
      attributionMethod: "CODE",
      commissionCents: 2000, // PERCENT program → 10% of $200.00 subtotal
    });
  });

  it("is idempotent when the same webhook is delivered twice", async () => {
    const queue = new InMemoryQueue();
    const store = new InMemoryStore();

    await queue.send("webhooks", orderWebhook(1002));
    await queue.send("webhooks", orderWebhook(1002)); // duplicate delivery
    await drainQueue(queue, "webhooks", makeDispatch(store), { budgetMs: 1000, now: () => queue.now++ });

    expect(store.referrals).toHaveLength(1);
    expect(store.ledger.filter((l) => l.type === "COMMISSION_EARNED")).toHaveLength(1);
  });

  it("attributes by referral link when there is no code", async () => {
    const queue = new InMemoryQueue();
    const store = new InMemoryStore();

    await queue.send(
      "webhooks",
      orderWebhook(1003, { discount_codes: [], landing_site: "/?ref=jane-doe-x7k2&utm_source=ascend" }),
    );
    await drainQueue(queue, "webhooks", makeDispatch(store), { budgetMs: 1000, now: () => queue.now++ });

    expect(store.referrals[0]?.attributionMethod).toBe("LINK");
  });

  it("writes a proportional reversal on refund, idempotently", async () => {
    const queue = new InMemoryQueue();
    const store = new InMemoryStore();

    await queue.send("webhooks", orderWebhook(1004));
    await drainQueue(queue, "webhooks", makeDispatch(store), { budgetMs: 1000, now: () => queue.now++ });

    const refund: WebhookJob = {
      type: "webhook",
      webhookId: "wh_refund_1",
      topic: "refunds/create",
      shop: "demo.myshopify.com",
      payload: { id: 555, order_id: 1004, refund_line_items: [{ subtotal: "100.00" }] },
    };
    await queue.send("webhooks", refund);
    await queue.send("webhooks", { ...refund, webhookId: "wh_refund_1_dup" }); // duplicate
    await drainQueue(queue, "webhooks", makeDispatch(store), { budgetMs: 1000, now: () => queue.now++ });

    const earned = store.ledger.find((l) => l.type === "COMMISSION_EARNED")!;
    const reversals = store.ledger.filter((l) => l.type === "COMMISSION_REVERSED");
    expect(reversals).toHaveLength(1);
    // $100 of $200 refunded → half the commission reversed
    expect(reversals[0].amountCents).toBe(-earned.amountCents / 2);

    const balances = computeBalances(store.ledger.filter((l) => l.ambassadorId === "amb_jane"));
    expect(balances.commissionPendingCents).toBe(earned.amountCents / 2);
  });

  it("dead-letters poison messages after max attempts instead of looping forever", async () => {
    const queue = new InMemoryQueue();
    const store = new InMemoryStore();
    const dispatch = async (payload: JobMessage) => {
      if ((payload as WebhookJob).webhookId === "poison") throw new Error("boom");
      return makeDispatch(store)(payload);
    };

    await queue.send("webhooks", { ...orderWebhook(1), webhookId: "poison" });

    for (let attempt = 0; attempt < 4; attempt++) {
      await drainQueue(queue, "webhooks", dispatch, { budgetMs: 500, maxAttempts: 3, visibilityTimeoutSeconds: 1, now: () => queue.now++ });
      queue.tick(2000); // let the visibility timeout lapse → redelivery
    }

    expect(queue.deadLetters).toHaveLength(1);
    expect(queue.pendingCount("webhooks")).toBe(0);
    expect(store.referrals).toHaveLength(0);
  });
});
