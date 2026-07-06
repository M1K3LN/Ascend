import prisma from "../db.server";

/**
 * The ledger's append-only trigger blocks DELETE unless the transaction-local
 * `ascend.allow_ledger_delete` flag is set. These helpers are the ONLY places
 * allowed to set it: full-tenant erasure (GDPR shop/redact) and single
 * ambassador deletion. Everything else must write compensating entries.
 */

export async function eraseMerchant(shopDomain: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select set_config('ascend.allow_ledger_delete', 'on', true)`;
    await tx.merchant.deleteMany({ where: { shopDomain } });
  });
}

export async function eraseAmbassador(merchantId: string, ambassadorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select set_config('ascend.allow_ledger_delete', 'on', true)`;
    await tx.ambassador.deleteMany({ where: { id: ambassadorId, merchantId } });
  });
}
