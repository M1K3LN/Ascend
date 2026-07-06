/**
 * Queue abstraction over Supabase pgmq. The app implements this with raw SQL
 * through Prisma; tests use the in-memory implementation in testing/.
 */

export interface QueueMessage<T = unknown> {
  msgId: string;
  /** Times this message has been read (pgmq read_ct). 1 on first delivery. */
  readCount: number;
  payload: T;
}

export interface QueueClient {
  send(queue: string, payload: unknown, delaySeconds?: number): Promise<void>;
  /** Read up to `qty` messages, hiding them for `visibilityTimeoutSeconds`. */
  read(queue: string, qty: number, visibilityTimeoutSeconds: number): Promise<QueueMessage[]>;
  /** Acknowledge successful processing (moves to pgmq archive). */
  archive(queue: string, msgId: string): Promise<void>;
  /** Move a poisoned message to the dead-letter store and archive it. */
  deadLetter(queue: string, message: QueueMessage, error: string): Promise<void>;
}

/** Message envelopes for every queue in the system. */

export interface WebhookJob {
  type: "webhook";
  webhookId: string;
  topic: string;
  shop: string;
  payload: unknown;
}

export interface CsvImportJob {
  type: "csv_import";
  importJobId: string;
}

export type JobMessage = WebhookJob | CsvImportJob | { type: string; [key: string]: unknown };
