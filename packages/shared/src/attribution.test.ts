import { describe, expect, it } from "vitest";
import { extractAttributionCandidates, resolveAttribution, type AttributionLookups } from "./attribution.js";

const order = (overrides: Record<string, unknown> = {}) => ({
  id: 1001,
  name: "#1001",
  subtotal_price: "100.00",
  total_price: "110.00",
  currency: "USD",
  ...overrides,
});

describe("extractAttributionCandidates", () => {
  it("extracts uppercased discount codes", () => {
    const c = extractAttributionCandidates(order({ discount_codes: [{ code: "jane10" }, { code: " VIP " }] }));
    expect(c.codes).toEqual(["JANE10", "VIP"]);
  });

  it("extracts ref slug from landing_site query params", () => {
    const c = extractAttributionCandidates(order({ landing_site: "/?ref=jane-doe-x7k2&utm_source=ascend" }));
    expect(c.refSlug).toBe("jane-doe-x7k2");
  });

  it("falls back to utm_campaign when utm_source=ascend", () => {
    const c = extractAttributionCandidates(
      order({ landing_site: "/products/x?utm_source=ascend&utm_medium=ambassador&utm_campaign=jane-doe-x7k2" }),
    );
    expect(c.refSlug).toBe("jane-doe-x7k2");
  });

  it("prefers cart note attributes over landing_site", () => {
    const c = extractAttributionCandidates(
      order({
        landing_site: "/?ref=other-slug",
        note_attributes: [{ name: "ascend_ref", value: "jane-doe-x7k2" }],
      }),
    );
    expect(c.refSlug).toBe("jane-doe-x7k2");
  });

  it("extracts the customer id", () => {
    const c = extractAttributionCandidates(order({ customer: { id: 987654 } }));
    expect(c.customerId).toBe("987654");
  });
});

function lookups(overrides: Partial<AttributionLookups> = {}): AttributionLookups {
  return {
    findByDiscountCode: async () => null,
    findByReferralSlug: async () => null,
    findByShopifyCustomerId: async () => null,
    ...overrides,
  };
}

const jane = { id: "amb_1", tier: "gold", status: "ACTIVE" };

describe("resolveAttribution", () => {
  it("prefers CODE over LINK over CUSTOMER", async () => {
    const result = await resolveAttribution(
      order({
        discount_codes: [{ code: "JANE10" }],
        landing_site: "/?ref=someone-else",
        customer: { id: 1 },
      }),
      lookups({
        findByDiscountCode: async (code) => (code === "JANE10" ? jane : null),
        findByReferralSlug: async () => ({ id: "amb_2", tier: null, status: "ACTIVE" }),
        findByShopifyCustomerId: async () => ({ id: "amb_3", tier: null, status: "ACTIVE" }),
      }),
    );
    expect(result).toEqual({ ambassador: jane, method: "CODE", matchedValue: "JANE10" });
  });

  it("skips inactive ambassadors and falls through to the next method", async () => {
    const result = await resolveAttribution(
      order({ discount_codes: [{ code: "JANE10" }], customer: { id: 42 } }),
      lookups({
        findByDiscountCode: async () => ({ id: "amb_x", tier: null, status: "INACTIVE" }),
        findByShopifyCustomerId: async () => jane,
      }),
    );
    expect(result?.method).toBe("CUSTOMER");
    expect(result?.ambassador.id).toBe("amb_1");
  });

  it("returns null when nothing matches", async () => {
    expect(await resolveAttribution(order(), lookups())).toBeNull();
  });
});
