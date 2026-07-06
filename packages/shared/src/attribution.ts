/**
 * Order attribution. Precedence (highest wins):
 *   1. CODE     — a discount code on the order matches an ambassador's code
 *   2. LINK     — referral slug found in landing-site UTM/ref params or cart
 *                 note attributes (set by our /a/:shop/r/:slug redirect)
 *   3. CUSTOMER — the buyer is a Shopify customer linked to an ambassador
 */

export type AttributionMethod = "CODE" | "LINK" | "CUSTOMER";

export interface OrderPayloadLike {
  id: number | string;
  name?: string;
  currency?: string;
  subtotal_price?: string | number;
  total_price?: string | number;
  discount_codes?: Array<{ code?: string }>;
  landing_site?: string | null;
  note_attributes?: Array<{ name?: string; value?: string }>;
  customer?: { id?: number | string } | null;
}

export interface AttributionCandidates {
  codes: string[];
  refSlug: string | null;
  customerId: string | null;
}

const REF_PARAM_NAMES = ["ref", "ascend_ref", "sca_ref"];
const REF_ATTRIBUTE_NAMES = ["ascend_ref", "ref", "referral"];

export function extractAttributionCandidates(order: OrderPayloadLike): AttributionCandidates {
  const codes = (order.discount_codes ?? [])
    .map((d) => (d.code ?? "").trim().toUpperCase())
    .filter(Boolean);

  let refSlug: string | null = null;

  // Cart note attributes win over landing-site params — they survive a long
  // browsing session while landing_site only reflects the first page hit.
  for (const attr of order.note_attributes ?? []) {
    if (attr.name && REF_ATTRIBUTE_NAMES.includes(attr.name.toLowerCase()) && attr.value) {
      refSlug = attr.value.trim();
      break;
    }
  }

  if (!refSlug && order.landing_site) {
    const query = order.landing_site.split("?")[1];
    if (query) {
      const params = new URLSearchParams(query);
      for (const name of REF_PARAM_NAMES) {
        const value = params.get(name);
        if (value) {
          refSlug = value.trim();
          break;
        }
      }
      // Our referral redirect also stamps utm_source=ascend&utm_campaign=<slug>.
      if (!refSlug && params.get("utm_source") === "ascend" && params.get("utm_campaign")) {
        refSlug = params.get("utm_campaign")!.trim();
      }
    }
  }

  const customerId = order.customer?.id != null ? String(order.customer.id) : null;

  return { codes, refSlug: refSlug || null, customerId };
}

export interface AmbassadorRef {
  id: string;
  tier: string | null;
  status: string;
}

/** Lookup functions the resolver needs; implemented against Prisma in the app. */
export interface AttributionLookups {
  findByDiscountCode(code: string): Promise<AmbassadorRef | null>;
  findByReferralSlug(slug: string): Promise<AmbassadorRef | null>;
  findByShopifyCustomerId(customerId: string): Promise<AmbassadorRef | null>;
}

export interface AttributionResult {
  ambassador: AmbassadorRef;
  method: AttributionMethod;
  matchedValue: string;
}

export async function resolveAttribution(
  order: OrderPayloadLike,
  lookups: AttributionLookups,
): Promise<AttributionResult | null> {
  const { codes, refSlug, customerId } = extractAttributionCandidates(order);

  for (const code of codes) {
    const ambassador = await lookups.findByDiscountCode(code);
    if (ambassador && ambassador.status === "ACTIVE") {
      return { ambassador, method: "CODE", matchedValue: code };
    }
  }

  if (refSlug) {
    const ambassador = await lookups.findByReferralSlug(refSlug);
    if (ambassador && ambassador.status === "ACTIVE") {
      return { ambassador, method: "LINK", matchedValue: refSlug };
    }
  }

  if (customerId) {
    const ambassador = await lookups.findByShopifyCustomerId(customerId);
    if (ambassador && ambassador.status === "ACTIVE") {
      return { ambassador, method: "CUSTOMER", matchedValue: customerId };
    }
  }

  return null;
}
