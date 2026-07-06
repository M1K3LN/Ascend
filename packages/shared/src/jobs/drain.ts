import type { JobMessage, QueueClient, QueueMessage } from "./queue.js";

export type JobHandler = (payload: JobMessage, message: QueueMessage) => Promise<void>;

export interface DrainOptions {
  /** Stop reading new batches once this much wall-clock time has elapsed. */
  budgetMs?: number;
  batchSize?: number;
  visibilityTimeoutSeconds?: number;
  /** Delivery attempts (pgmq read_ct) before a message is dead-lettered. */
  maxAttempts?: number;
  onError?: (error: unknown, message: QueueMessage) => void;
  now?: () => number;
}

export interface DrainStats {
  processed: number;
  failed: number;
  deadLettered: number;
  batches: number;
}

/**
 * Core drain loop shared by the Vercel cron route and the integration tests.
 * Semantics: archive on success; on failure do nothing (the visibility
 * timeout re-delivers with an incremented read_ct); after maxAttempts
 * deliveries, dead-letter. Handlers must be idempotent — pgmq is
 * at-least-once delivery.
 */
export async function drainQueue(
  queueClient: QueueClient,
  queue: string,
  dispatch: (payload: JobMessage, message: QueueMessage) => Promise<void>,
  options: DrainOptions = {},
): Promise<DrainStats> {
  const {
    budgetMs = 50_000,
    batchSize = 10,
    visibilityTimeoutSeconds = 90,
    maxAttempts = 5,
    onError,
    now = Date.now,
  } = options;

  const deadline = now() + budgetMs;
  const stats: DrainStats = { processed: 0, failed: 0, deadLettered: 0, batches: 0 };

  while (now() < deadline) {
    const messages = await queueClient.read(queue, batchSize, visibilityTimeoutSeconds);
    if (messages.length === 0) break;
    stats.batches++;

    for (const message of messages) {
      if (now() >= deadline) break;
      if (message.readCount > maxAttempts) {
        await queueClient.deadLetter(queue, message, `exceeded ${maxAttempts} delivery attempts`);
        stats.deadLettered++;
        continue;
      }
      try {
        await dispatch(message.payload as JobMessage, message);
        await queueClient.archive(queue, message.msgId);
        stats.processed++;
      } catch (error) {
        stats.failed++;
        onError?.(error, message);
        // Leave the message; visibility timeout requeues it.
      }
    }
  }

  return stats;
}
