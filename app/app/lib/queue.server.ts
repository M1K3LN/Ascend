import { Prisma } from "@prisma/client";
import type { QueueClient, QueueMessage } from "@ascend/shared";
import prisma from "../db.server";

/**
 * pgmq-backed queue client. All calls go through the pooled Prisma connection
 * (transaction mode is fine — each statement is standalone) so enqueues can
 * also participate in prisma.$transaction with the rows they reference.
 */

export const QUEUES = {
  webhooks: "webhooks",
  imports: "imports",
  emails: "emails",
  discountSync: "discount_sync",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export function isKnownQueue(name: string): name is QueueName {
  return Object.values(QUEUES).includes(name as QueueName);
}

interface PgmqReadRow {
  msg_id: bigint;
  read_ct: number;
  message: unknown;
}

export class PgmqQueueClient implements QueueClient {
  async send(queue: string, payload: unknown, delaySeconds = 0): Promise<void> {
    await prisma.$queryRaw`
      select pgmq.send(${queue}::text, ${JSON.stringify(payload)}::jsonb, ${delaySeconds}::int)
    `;
  }

  async read(queue: string, qty: number, visibilityTimeoutSeconds: number): Promise<QueueMessage[]> {
    const rows = await prisma.$queryRaw<PgmqReadRow[]>`
      select msg_id, read_ct, message
      from pgmq.read(${queue}::text, ${visibilityTimeoutSeconds}::int, ${qty}::int)
    `;
    return rows.map((row) => ({
      msgId: row.msg_id.toString(),
      readCount: row.read_ct,
      payload: row.message,
    }));
  }

  async archive(queue: string, msgId: string): Promise<void> {
    await prisma.$queryRaw`select pgmq.archive(${queue}::text, ${BigInt(msgId)}::bigint)`;
  }

  async deadLetter(queue: string, message: QueueMessage, error: string): Promise<void> {
    await prisma.deadLetter.create({
      data: {
        queue,
        msgId: message.msgId,
        payload: (message.payload ?? {}) as Prisma.InputJsonValue,
        error,
        attempts: message.readCount,
      },
    });
    await this.archive(queue, message.msgId);
  }
}

export const queueClient = new PgmqQueueClient();

export async function enqueue(queue: QueueName, payload: unknown, delaySeconds = 0): Promise<void> {
  await queueClient.send(queue, payload, delaySeconds);
}
