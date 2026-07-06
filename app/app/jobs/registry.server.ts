import {
  handleCsvImport,
  handleOrderCreated,
  handleRefundCreated,
  type CsvImportJob,
  type JobMessage,
  type OrderPayloadLike,
  type RefundPayloadLike,
  type WebhookJob,
} from "@ascend/shared";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { csvImportDeps, orderCreatedDeps, refundDeps } from "./deps.server";

/**
 * Central job dispatch used by /api/jobs/drain. Every handler is idempotent —
 * pgmq is at-least-once delivery and webhooks can arrive twice.
 */
export async function dispatchJob(payload: JobMessage): Promise<void> {
  switch (payload.type) {
    case "webhook":
      return dispatchWebhook(payload as WebhookJob);
    case "csv_import":
      return dispatchCsvImport(payload as CsvImportJob);
    default:
      // Unknown job types are acked (forward-compat when old queue messages
      // outlive a deploy); they land in the archive for inspection.
      console.warn(`[jobs] unknown job type: ${payload.type}`);
  }
}

async function dispatchCsvImport(job: CsvImportJob): Promise<void> {
  await handleCsvImport(csvImportDeps(), job.importJobId);
}

async function dispatchWebhook(job: WebhookJob): Promise<void> {
  const merchant = await prisma.merchant.findUnique({ where: { shopDomain: job.shop } });

  switch (job.topic) {
    case "orders/create":
    case "orders/updated": {
      if (!merchant) return;
      // orders/updated re-runs attribution: a no-op when the referral exists,
      // and catches orders whose codes/attributes were added post-creation.
      const result = await handleOrderCreated(
        orderCreatedDeps(merchant.id),
        job.payload as OrderPayloadLike,
        merchant.currency,
      );
      console.log(`[jobs] ${job.topic} ${job.webhookId}: ${result.outcome}`);
      break;
    }

    case "refunds/create": {
      if (!merchant) return;
      const result = await handleRefundCreated(refundDeps(merchant.id), job.payload as RefundPayloadLike);
      console.log(`[jobs] refunds/create ${job.webhookId}: ${result.outcome}`);
      break;
    }

    case "app/uninstalled": {
      await prisma.session.deleteMany({ where: { shop: job.shop } });
      if (merchant) {
        await prisma.merchant.update({
          where: { id: merchant.id },
          data: { uninstalledAt: new Date(), encryptedAccessToken: null },
        });
      }
      break;
    }

    // ── Mandatory GDPR topics (real deletion) ────────────────────────────
    case "customers/data_request": {
      await recordGdpr(job, "CUSTOMERS_DATA_REQUEST");
      // Data we hold on a shop customer is limited to linked ambassador rows;
      // surface the request in /app/jobs for the merchant to fulfil.
      break;
    }

    case "customers/redact": {
      const request = await recordGdpr(job, "CUSTOMERS_REDACT");
      const payload = job.payload as { customer?: { id?: number; email?: string } };
      const customerId = payload.customer?.id != null ? String(payload.customer.id) : null;
      const email = payload.customer?.email?.toLowerCase();
      if (merchant && (customerId || email)) {
        const targets = await prisma.ambassador.findMany({
          where: {
            merchantId: merchant.id,
            OR: [
              ...(customerId ? [{ shopifyCustomerId: customerId }] : []),
              ...(email ? [{ email }] : []),
            ],
          },
          select: { id: true },
        });
        // Anonymize PII; keep ledger integrity (financial records reference ids only).
        for (const target of targets) {
          await prisma.ambassador.update({
            where: { id: target.id },
            data: {
              name: "Redacted",
              email: `redacted-${target.id}@example.invalid`,
              shopifyCustomerId: null,
              notes: null,
              tags: [],
              status: "INACTIVE",
            },
          });
        }
      }
      await completeGdpr(request.id);
      break;
    }

    case "shop/redact": {
      const request = await recordGdpr(job, "SHOP_REDACT");
      // Full tenant deletion — cascades to ambassadors, ledger, referrals, etc.
      await prisma.merchant.deleteMany({ where: { shopDomain: job.shop } });
      await prisma.session.deleteMany({ where: { shop: job.shop } });
      await completeGdpr(request.id);
      break;
    }

    default:
      console.warn(`[jobs] unhandled webhook topic: ${job.topic}`);
  }

  await prisma.webhookEvent.updateMany({
    where: { id: job.webhookId },
    data: { processedAt: new Date() },
  });
}

async function recordGdpr(job: WebhookJob, type: "CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT" | "SHOP_REDACT") {
  return prisma.gdprRequest.create({
    data: { shop: job.shop, type, payload: (job.payload ?? {}) as Prisma.InputJsonValue },
  });
}

async function completeGdpr(id: string) {
  await prisma.gdprRequest.update({ where: { id }, data: { status: "completed", completedAt: new Date() } });
}
