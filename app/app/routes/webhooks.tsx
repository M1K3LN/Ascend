import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueue, QUEUES } from "../lib/queue.server";

/**
 * Single webhook endpoint for all topics (incl. GDPR compliance topics).
 * authenticate.webhook verifies the HMAC (throws 401 otherwise). The handler
 * only dedupes + enqueues + returns 200 — always well inside Shopify's 5s
 * timeout. All real work happens in /api/jobs/drain.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, webhookId } = await authenticate.webhook(request);

  try {
    // Idempotency: one row per delivery id; a replayed delivery short-circuits.
    await prisma.webhookEvent.create({ data: { id: webhookId, shop, topic } });
  } catch {
    return new Response(); // duplicate delivery — already recorded/enqueued
  }

  await enqueue(QUEUES.webhooks, {
    type: "webhook",
    webhookId,
    topic: topic.toLowerCase().replace(/_/g, "/"),
    shop,
    payload,
  });

  return new Response();
};
