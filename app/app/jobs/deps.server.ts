import { Prisma } from "@prisma/client";
import type { CsvImportDeps, OrderCreatedDeps, RefundDeps } from "@ascend/shared";
import prisma from "../db.server";
import { downloadImportCsv } from "../lib/supabase.server";

/** Prisma-backed implementations of the shared job handler dependencies. */

export function orderCreatedDeps(merchantId: string): OrderCreatedDeps {
  const ambassadorRef = (a: { id: string; tier: string; status: string } | null) =>
    a ? { id: a.id, tier: a.tier, status: a.status } : null;

  return {
    lookups: {
      findByDiscountCode: async (code) => {
        const config = await prisma.discountConfig.findFirst({
          where: { merchantId, code: { equals: code, mode: "insensitive" } },
          include: { ambassador: { select: { id: true, tier: true, status: true } } },
        });
        return ambassadorRef(config?.ambassador ?? null);
      },
      findByReferralSlug: async (slug) =>
        ambassadorRef(
          await prisma.ambassador.findFirst({
            where: { merchantId, referralSlug: slug },
            select: { id: true, tier: true, status: true },
          }),
        ),
      findByShopifyCustomerId: async (customerId) =>
        ambassadorRef(
          await prisma.ambassador.findFirst({
            where: { merchantId, shopifyCustomerId: customerId },
            select: { id: true, tier: true, status: true },
          }),
        ),
    },
    getProgram: async () => {
      const program = await prisma.program.findFirst({ where: { merchantId, isDefault: true } });
      if (!program) return null;
      return {
        commissionType: program.commissionType,
        percentBps: program.percentBps,
        flatCents: program.flatCents,
        tiers: (program.tiers as Record<string, { percentBps?: number; flatCents?: number }> | null) ?? null,
        autoApproveReferrals: program.autoApproveReferrals,
      };
    },
    createReferralWithLedger: async (input) => {
      try {
        await prisma.$transaction(async (tx) => {
          const referral = await tx.referral.create({
            data: {
              merchantId,
              ambassadorId: input.ambassadorId,
              orderId: input.orderId,
              orderName: input.orderName,
              attributionMethod: input.attributionMethod,
              matchedValue: input.matchedValue,
              orderSubtotalCents: input.orderSubtotalCents,
              orderTotalCents: input.orderTotalCents,
              commissionCents: input.commissionCents,
              currency: input.currency,
              status: input.autoApprove ? "APPROVED" : "PENDING",
            },
          });
          if (input.ledgerEntry) {
            await tx.ledgerEntry.create({
              data: { merchantId, referralId: referral.id, ...input.ledgerEntry },
            });
          }
        });
        return { created: true };
      } catch (error) {
        // Unique violation on (merchantId, orderId) or idempotencyKey → the
        // webhook was already processed. At-least-once delivery makes this normal.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { created: false };
        }
        throw error;
      }
    },
  };
}

export function refundDeps(merchantId: string): RefundDeps {
  return {
    findReferralByOrderId: async (orderId) => {
      const referral = await prisma.referral.findUnique({
        where: { merchantId_orderId: { merchantId, orderId } },
      });
      return referral
        ? {
            id: referral.id,
            ambassadorId: referral.ambassadorId,
            commissionCents: referral.commissionCents,
            orderSubtotalCents: referral.orderSubtotalCents,
            currency: referral.currency,
            status: referral.status,
          }
        : null;
    },
    sumReversedCents: async (referralId) => {
      const result = await prisma.ledgerEntry.aggregate({
        where: { referralId, type: "COMMISSION_REVERSED" },
        _sum: { amountCents: true },
      });
      return result._sum.amountCents ?? 0;
    },
    writeReversal: async (input) => {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.ledgerEntry.create({
            data: {
              merchantId,
              ambassadorId: input.ambassadorId,
              referralId: input.referralId,
              type: "COMMISSION_REVERSED",
              amountCents: input.amountCents,
              currency: input.currency,
              orderId: input.orderId,
              idempotencyKey: input.idempotencyKey,
              memo: input.memo,
            },
          });
          if (input.fullyReversed) {
            await tx.referral.update({ where: { id: input.referralId }, data: { status: "REVERSED" } });
          }
        });
        return { created: true };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { created: false };
        }
        throw error;
      }
    },
  };
}

export function csvImportDeps(): CsvImportDeps {
  return {
    getImportJob: async (importJobId) => {
      const job = await prisma.importJob.findUnique({ where: { id: importJobId } });
      if (!job) return null;
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "PROCESSING" } });
      return { id: job.id, merchantId: job.merchantId, storagePath: job.storagePath };
    },
    downloadFile: downloadImportCsv,
    findExistingEmails: async (merchantId, candidates) => {
      const existing = await prisma.ambassador.findMany({
        where: { merchantId, email: { in: candidates } },
        select: { email: true },
      });
      return new Set(existing.map((a) => a.email));
    },
    createAmbassadors: async (merchantId, rows) => {
      const result = await prisma.ambassador.createMany({
        data: rows.map((row) => ({
          merchantId,
          name: row.name,
          email: row.email,
          tier: row.tier || "default",
          tags: row.tags,
          referralSlug: row.referralSlug,
          shopifyCustomerId: row.shopifyCustomerId || null,
          status: "ACTIVE",
        })),
        skipDuplicates: true,
      });
      return result.count;
    },
    completeImportJob: async (importJobId, result) => {
      await prisma.importJob.update({
        where: { id: importJobId },
        data: {
          status: "COMPLETED",
          totalRows: result.totalRows,
          created: result.created,
          duplicates: result.duplicatesInFile + result.duplicatesInDb,
          errors: result.errors as unknown as Prisma.InputJsonValue,
        },
      });
    },
    failImportJob: async (importJobId, error) => {
      await prisma.importJob.update({
        where: { id: importJobId },
        data: { status: "FAILED", failReason: error },
      });
    },
  };
}
