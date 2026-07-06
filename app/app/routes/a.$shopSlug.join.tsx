import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { generateReferralSlug } from "@ascend/shared";
import prisma from "../db.server";
import { getMerchantBySlug } from "../lib/merchant.server";

/**
 * Public, brandable ambassador registration page: /a/:shopSlug/join
 * No Shopify auth — styled from merchant.settings (brand color, copy).
 */

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `${data.brand.headline} — ${data.shopName}` : "Join" },
];

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantBySlug(params.shopSlug!);
  if (!merchant || merchant.uninstalledAt) throw new Response("Not found", { status: 404 });
  const settings = (merchant.settings ?? {}) as Record<string, string>;
  return json({
    shopName: merchant.shopSlug,
    brand: {
      color: settings.brandColor || "#4f46e5",
      headline: settings.joinHeadline || "Become an ambassador",
      description:
        settings.joinDescription ||
        "Earn commission on every sale you refer, plus store credit and exclusive perks.",
    },
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantBySlug(params.shopSlug!);
  if (!merchant || merchant.uninstalledAt) throw new Response("Not found", { status: 404 });

  const formData = await request.formData();
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  // Honeypot field: bots fill it, humans never see it.
  if (String(formData.get("website") || "")) return json({ ok: true, pending: true });

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please provide your name and a valid email." }, { status: 400 });
  }

  const autoApprove = merchant.programs[0]?.autoApproveAmbassadors ?? false;

  try {
    await prisma.ambassador.create({
      data: {
        merchantId: merchant.id,
        name,
        email,
        status: autoApprove ? "ACTIVE" : "PENDING",
        referralSlug: generateReferralSlug(name),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Already applied — don't leak membership; show the same success state.
      return json({ ok: true, pending: !autoApprove });
    }
    throw error;
  }
  return json({ ok: true, pending: !autoApprove });
};

export default function JoinPage() {
  const { brand, shopName } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as
    | { ok?: boolean; pending?: boolean; error?: string }
    | undefined;
  const navigation = useNavigation();

  const input: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    fontSize: 16,
    boxSizing: "border-box",
  };

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh", background: "#f9fafb" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "8vh 20px" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,.1)" }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: brand.color, marginBottom: 16 }} />
          <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>{brand.headline}</h1>
          <p style={{ color: "#6b7280", margin: "0 0 24px" }}>{brand.description}</p>

          {actionData?.ok ? (
            <div style={{ padding: 16, borderRadius: 8, background: "#ecfdf5", color: "#065f46" }}>
              {actionData.pending
                ? "Thanks for applying! The team will review your application and you'll hear back by email."
                : "You're in! Check your email for your referral link and next steps."}
            </div>
          ) : (
            <Form method="post">
              <div style={{ display: "grid", gap: 12 }}>
                {actionData?.error && (
                  <div style={{ padding: 12, borderRadius: 8, background: "#fef2f2", color: "#991b1b" }}>
                    {actionData.error}
                  </div>
                )}
                <input style={input} name="name" placeholder="Your name" required />
                <input style={input} name="email" type="email" placeholder="you@example.com" required />
                <input name="website" tabIndex={-1} autoComplete="off" style={{ display: "none" }} aria-hidden />
                <button
                  type="submit"
                  disabled={navigation.state === "submitting"}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 8,
                    border: "none",
                    background: brand.color,
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {navigation.state === "submitting" ? "Submitting…" : "Apply now"}
                </button>
              </div>
            </Form>
          )}
          <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 24 }}>
            {shopName} ambassador program · powered by Ascend
          </p>
        </div>
      </div>
    </div>
  );
}
