import "@shopify/shopify-app-remix/adapters/node";
import { ApiVersion, AppDistribution, shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { EncryptedSessionStorage } from "./lib/session-storage.server";
import { upsertMerchantFromSession } from "./lib/merchant.server";

// App URL: explicit env var, else Vercel's production domain (system env),
// so the app can boot (public pages, healthz) before Shopify creds are set.
const appUrl =
  process.env.SHOPIFY_APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

if (!process.env.SHOPIFY_API_SECRET) {
  console.warn(
    "[shopify] SHOPIFY_API_SECRET is not set — OAuth/webhooks will fail until real Shopify app credentials are configured.",
  );
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "placeholder-api-key",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "placeholder-api-secret",
  apiVersion: ApiVersion.April25,
  scopes: (process.env.SCOPES || "read_orders,read_customers,read_products,write_discounts").split(","),
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new EncryptedSessionStorage(new PrismaSessionStorage(prisma)),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
  hooks: {
    afterAuth: async ({ session }) => {
      await upsertMerchantFromSession(session);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] } : {}),
});

export default shopify;
export const apiVersion = ApiVersion.April25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
