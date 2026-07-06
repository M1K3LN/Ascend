import type { QueueClient, QueueMessage } from "../jobs/queue.js";

interface StoredMessage {
  msgId: string;
  readCount: number;
  payload: unknown;
  visibleAt: number;
  archived: boolean;
}

/** In-memory pgmq semantics (visibility timeout, read_ct, archive) for tests. */
export class InMemoryQueue implements QueueClient {
  private queues = new Map<string, StoredMessage[]>();
  public deadLetters: Array<{ queue: string; message: QueueMessage; error: string }> = [];
  private nextId = 1;
  public now = 0; // virtual clock (ms)

  private q(queue: string): StoredMessage[] {
    if (!this.queues.has(queue)) this.queues.set(queue, []);
    return this.queues.get(queue)!;
  }

  async send(queue: string, payload: unknown, delaySeconds = 0): Promise<void> {
    this.q(queue).push({
      msgId: String(this.nextId++),
      readCount: 0,
      payload,
      visibleAt: this.now + delaySeconds * 1000,
      archived: false,
    });
  }

  async read(queue: string, qty: number, visibilityTimeoutSeconds: number): Promise<QueueMessage[]> {
    const out: QueueMessage[] = [];
    for (const msg of this.q(queue)) {
      if (out.length >= qty) break;
      if (msg.archived || msg.visibleAt > this.now) continue;
      msg.readCount++;
      msg.visibleAt = this.now + visibilityTimeoutSeconds * 1000;
      out.push({ msgId: msg.msgId, readCount: msg.readCount, payload: msg.payload });
    }
    return out;
  }

  async archive(queue: string, msgId: string): Promise<void> {
    const msg = this.q(queue).find((m) => m.msgId === msgId);
    if (msg) msg.archived = true;
  }

  async deadLetter(queue: string, message: QueueMessage, error: string): Promise<void> {
    this.deadLetters.push({ queue, message, error });
    await this.archive(queue, message.msgId);
  }

  /** Advance the virtual clock so invisible messages become visible again. */
  tick(ms: number): void {
    this.now += ms;
  }

  pendingCount(queue: string): number {
    return this.q(queue).filter((m) => !m.archived).length;
  }
}
