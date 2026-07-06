import { vitePlugin as remix } from "@remix-run/dev";
import { vercelPreset } from "@vercel/remix/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Shopify CLI tunnel host handling (from the official Remix app template).
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL || process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost").hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = { protocol: "ws", host: "localhost", port: 64999, clientPort: 64999 };
} else {
  hmrConfig = { protocol: "wss", host, port: parseInt(process.env.FRONTEND_PORT!) || 8002, clientPort: 443 };
}

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: { preflightContinue: true },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: { allow: ["app", "node_modules", "../packages"] },
  },
  plugins: [
    remix({
      // Only apply the Vercel preset on Vercel builds so `shopify app dev`
      // keeps using the plain node server output locally.
      presets: process.env.VERCEL ? [vercelPreset()] : [],
      ignoredRouteFiles: ["**/.*"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: false,
        v3_routeConfig: false,
      },
    }),
    tsconfigPaths(),
  ],
  build: { assetsInlineLimit: 0 },
  ssr: {
    noExternal: ["@ascend/shared"],
  },
  optimizeDeps: { include: ["@shopify/app-bridge-react", "@shopify/polaris"] },
}) satisfies UserConfig;
