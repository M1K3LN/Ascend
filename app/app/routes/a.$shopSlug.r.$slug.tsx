import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { getMerchantBySlug } from "../lib/merchant.server";

/**
 * Referral link: /a/:shopSlug/r/:referralSlug
 * Sets a first-party attribution cookie (window from the merchant's Program,
 * default 30 days) and redirects to the storefront with ref + UTM params.
 * Order attribution reads these params back from order.landing_site.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantBySlug(params.shopSlug!);
  if (!merchant || merchant.uninstalledAt) throw new Response("Not found", { status: 404 });

  const slug = params.slug!;
  const ambassador = await prisma.ambassador.findFirst({
    where: { merchantId: merchant.id, referralSlug: slug, status: "ACTIVE" },
    select: { id: true },
  });

  const target = new URL(`https://${merchant.shopDomain}/`);
  if (ambassador) {
    target.searchParams.set("ref", slug);
    target.searchParams.set("utm_source", "ascend");
    target.searchParams.set("utm_medium", "ambassador");
    target.searchParams.set("utm_campaign", slug);
  }

  const cookieWindowDays = merchant.programs[0]?.cookieWindowDays ?? 30;
  const headers = new Headers({ Location: target.toString() });
  if (ambassador) {
    headers.append(
      "Set-Cookie",
      `ascend_ref=${encodeURIComponent(slug)}; Max-Age=${cookieWindowDays * 86400}; Path=/; SameSite=Lax; Secure; HttpOnly`,
    );
  }
  return redirect(target.toString(), { headers });
};
