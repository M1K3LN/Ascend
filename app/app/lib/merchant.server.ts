import type { Session } from "@shopify/shopify-api";
import prisma from "../db.server";
import { encryptSecret } from "./crypto.server";

export function shopSlugFromDomain(shopDomain: string): string {
  return shopDomain.replace(/\.myshopify\.com$/i, "").toLowerCase();
}

/** Called from afterAuth: ensure Merchant + default Program exist. */
export async function upsertMerchantFromSession(session: Session) {
  const shopSlug = shopSlugFromDomain(session.shop);
  const encryptedAccessToken = session.accessToken ? encryptSecret(session.accessToken) : undefined;

  const merchant = await prisma.merchant.upsert({
    where: { shopDomain: session.shop },
    create: {
      shopDomain: session.shop,
      shopSlug,
      encryptedAccessToken,
      settings: { brandColor: "#4f46e5", joinHeadline: "Become an ambassador" },
    },
    update: {
      ...(encryptedAccessToken ? { encryptedAccessToken } : {}),
      uninstalledAt: null,
    },
  });

  const defaultProgram = await prisma.program.findFirst({
    where: { merchantId: merchant.id, isDefault: true },
  });
  if (!defaultProgram) {
    await prisma.program.create({
      data: { merchantId: merchant.id, isDefault: true, commissionType: "PERCENT", percentBps: 1000 },
    });
  }

  return merchant;
}

export async function getMerchantByShop(shop: string) {
  return prisma.merchant.findUnique({ where: { shopDomain: shop } });
}

export async function requireMerchantByShop(shop: string) {
  const merchant = await getMerchantByShop(shop);
  if (!merchant) throw new Response(`No merchant record for ${shop} — reinstall the app`, { status: 404 });
  return merchant;
}

export async function getMerchantBySlug(shopSlug: string) {
  return prisma.merchant.findUnique({
    where: { shopSlug: shopSlug.toLowerCase() },
    include: { programs: { where: { isDefault: true }, take: 1 } },
  });
}
