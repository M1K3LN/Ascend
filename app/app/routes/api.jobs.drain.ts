import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { drainQueue } from "@ascend/shared";
import { isKnownQueue, queueClient } from "../lib/queue.server";
import { dispatchJob } from "../jobs/registry.server";

// Vercel: allow long drains on job routes (plan maximum applies).
export const config = { maxDuration: 300 };

/**
 * Cron-driven queue drain: GET /api/jobs/drain?queue=<name>
 * Vercel Cron hits this every minute with `Authorization: Bearer $CRON_SECRET`
 * (sent automatically when the CRON_SECRET env var is set on the project).
 * Reads batches with a visibility timeout, archives on success, lets the
 * timeout requeue failures, dead-letters after max attempts.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const queue = new URL(request.url).searchParams.get("queue") ?? "";
  if (!isKnownQueue(queue)) {
    return json({ error: `unknown queue: ${queue}` }, { status: 400 });
  }

  const stats = await drainQueue(queueClient, queue, dispatchJob, {
    budgetMs: Number(process.env.DRAIN_BUDGET_MS || 50_000),
    batchSize: 10,
    visibilityTimeoutSeconds: 120,
    maxAttempts: 5,
    onError: (error, message) =>
      console.error(`[drain:${queue}] msg ${message.msgId} attempt ${message.readCount} failed:`, error),
  });

  return json({ queue, ...stats });
};
