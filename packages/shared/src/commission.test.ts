import { describe, expect, it } from "vitest";
import { computeCommissionCents, computeReversalCents } from "./commission.js";
import { decimalToCents } from "./money.js";

describe("computeCommissionCents", () => {
  it("computes percent commission in basis points", () => {
    expect(computeCommissionCents({ commissionType: "PERCENT", percentBps: 1000 }, 12345)).toBe(1235); // 10% of $123.45, rounded
    expect(computeCommissionCents({ commissionType: "PERCENT", percentBps: 1500 }, 10000)).toBe(1500);
    expect(computeCommissionCents({ commissionType: "PERCENT", percentBps: 0 }, 10000)).toBe(0);
  });

  it("rounds half-up deterministically", () => {
    // 2.5% of $1.00 = 2.5c → 3c
    expect(computeCommissionCents({ commissionType: "PERCENT", percentBps: 250 }, 100)).toBe(3);
    // 2.4% of $1.00 = 2.4c → 2c
    expect(computeCommissionCents({ commissionType: "PERCENT", percentBps: 240 }, 100)).toBe(2);
  });

  it("computes flat commission regardless of subtotal", () => {
    expect(computeCommissionCents({ commissionType: "FLAT", flatCents: 500 }, 99999)).toBe(500);
    expect(computeCommissionCents({ commissionType: "FLAT", flatCents: 500 }, 0)).toBe(500);
  });

  it("resolves tiered commission by ambassador tier with default fallback", () => {
    const program = {
      commissionType: "TIERED" as const,
      tiers: {
        default: { percentBps: 1000 },
        gold: { percentBps: 1500 },
        vip: { flatCents: 2500 },
      },
    };
    expect(computeCommissionCents(program, 10000, "gold")).toBe(1500);
    expect(computeCommissionCents(program, 10000, "vip")).toBe(2500);
    expect(computeCommissionCents(program, 10000, "unknown-tier")).toBe(1000);
    expect(computeCommissionCents(program, 10000, null)).toBe(1000);
  });

  it("rejects tiered programs without a default", () => {
    expect(() =>
      computeCommissionCents({ commissionType: "TIERED", tiers: { gold: { percentBps: 100 } } }, 100, "silver"),
    ).toThrow(/default/);
  });
});

describe("computeReversalCents", () => {
  it("reverses proportionally to the refunded amount", () => {
    expect(
      computeReversalCents({
        commissionEarnedCents: 1000,
        alreadyReversedCents: 0,
        orderSubtotalCents: 10000,
        refundedCents: 5000,
      }),
    ).toBe(500);
  });

  it("caps cumulative reversals at the earned commission", () => {
    expect(
      computeReversalCents({
        commissionEarnedCents: 1000,
        alreadyReversedCents: 800,
        orderSubtotalCents: 10000,
        refundedCents: 9000,
      }),
    ).toBe(200);
  });

  it("treats refunds above the subtotal as full reversal", () => {
    expect(
      computeReversalCents({
        commissionEarnedCents: 1000,
        alreadyReversedCents: 0,
        orderSubtotalCents: 10000,
        refundedCents: 25000,
      }),
    ).toBe(1000);
  });

  it("returns 0 when nothing was earned or refunded", () => {
    expect(
      computeReversalCents({ commissionEarnedCents: 0, alreadyReversedCents: 0, orderSubtotalCents: 100, refundedCents: 100 }),
    ).toBe(0);
    expect(
      computeReversalCents({ commissionEarnedCents: 100, alreadyReversedCents: 0, orderSubtotalCents: 100, refundedCents: 0 }),
    ).toBe(0);
  });
});

describe("decimalToCents", () => {
  it("parses Shopify decimal strings safely", () => {
    expect(decimalToCents("129.95")).toBe(12995);
    expect(decimalToCents("129.9")).toBe(12990);
    expect(decimalToCents("129")).toBe(12900);
    expect(decimalToCents("0.05")).toBe(5);
    expect(decimalToCents("-10.50")).toBe(-1050);
    expect(decimalToCents(null)).toBe(0);
    expect(decimalToCents("")).toBe(0);
  });
});
