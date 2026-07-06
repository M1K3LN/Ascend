import { describe, expect, it } from "vitest";
import { computeBalances, validateLedgerEntry } from "./ledger.js";

describe("computeBalances", () => {
  it("derives credit and commission balances from signed entries", () => {
    const balances = computeBalances([
      { type: "COMMISSION_EARNED", amountCents: 5000 },
      { type: "COMMISSION_EARNED", amountCents: 2500 },
      { type: "COMMISSION_REVERSED", amountCents: -500 },
      { type: "PAYOUT", amountCents: -3000 },
      { type: "CREDIT_ISSUED", amountCents: 2000 },
      { type: "CREDIT_REDEEMED", amountCents: -750 },
      { type: "CREDIT_EXPIRED", amountCents: -250 },
    ]);
    expect(balances.commissionPendingCents).toBe(5000 + 2500 - 500 - 3000);
    expect(balances.creditCents).toBe(2000 - 750 - 250);
    expect(balances.lifetimeCommissionCents).toBe(7500);
    expect(balances.paidOutCents).toBe(3000);
  });

  it("returns zeros for an empty ledger", () => {
    expect(computeBalances([])).toEqual({
      creditCents: 0,
      commissionPendingCents: 0,
      lifetimeCommissionCents: 0,
      paidOutCents: 0,
    });
  });

  it("rejects non-integer amounts", () => {
    expect(() => computeBalances([{ type: "CREDIT_ISSUED", amountCents: 10.5 }])).toThrow(/integer/);
  });
});

describe("validateLedgerEntry", () => {
  it("enforces sign conventions by type", () => {
    expect(() => validateLedgerEntry({ type: "COMMISSION_EARNED", amountCents: 100 })).not.toThrow();
    expect(() => validateLedgerEntry({ type: "COMMISSION_EARNED", amountCents: -100 })).toThrow(/positive/);
    expect(() => validateLedgerEntry({ type: "COMMISSION_REVERSED", amountCents: -100 })).not.toThrow();
    expect(() => validateLedgerEntry({ type: "COMMISSION_REVERSED", amountCents: 100 })).toThrow(/non-positive/);
    expect(() => validateLedgerEntry({ type: "PAYOUT", amountCents: 100 })).toThrow();
    expect(() => validateLedgerEntry({ type: "bogus", amountCents: 100 })).toThrow(/unknown/);
  });
});
