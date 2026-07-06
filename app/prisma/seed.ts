/* eslint-disable no-console */
import { faker } from "@faker-js/faker";
import { PrismaClient, type LedgerType, type Prisma } from "@prisma/client";

/**
 * Seed: demo merchant + 1,500 ambassadors with varied ledgers, referrals,
 * discount configs, and sample email templates — every feature demoable.
 * Idempotent-ish: wipes and recreates the demo merchant on each run.
 *
 * Run: npm run seed -w ascend-app   (needs DATABASE_URL / DIRECT_URL)
 */

const prisma = new PrismaClient();
const SHOP = "ascend-demo.myshopify.com";
const AMBASSADOR_COUNT = 1500;

faker.seed(42);

const TIERS = ["default", "default", "default", "silver", "gold", "vip"];
const TAG_POOL = ["fitness", "beauty", "yoga", "running", "nutrition", "lifestyle", "micro", "macro", "vip-event"];

async function main() {
  console.log("Seeding demo merchant…");
  await prisma.merchant.deleteMany({ where: { shopDomain: SHOP } });

  const merchant = await prisma.merchant.create({
    data: {
      shopDomain: SHOP,
      shopSlug: "ascend-demo",
      plan: "enterprise",
      currency: "USD",
      settings: {
        brandColor: "#4f46e5",
        joinHeadline: "Join the Ascend Demo crew",
        joinDescription: "Earn 10-15% commission, store credit, and early access to product drops.",
      },
    },
  });

  await prisma.program.create({
    data: {
      merchantId: merchant.id,
      isDefault: true,
      commissionType: "TIERED",
      tiers: {
        default: { percentBps: 1000 },
        silver: { percentBps: 1200 },
        gold: { percentBps: 1500 },
        vip: { percentBps: 2000 },
      },
      cookieWindowDays: 30,
      autoApproveAmbassadors: false,
      autoApproveReferrals: true,
    },
  });

  console.log(`Creating ${AMBASSADOR_COUNT} ambassadors…`);
  const usedEmails = new Set<string>();
  const usedSlugs = new Set<string>();
  const ambassadorData: Prisma.AmbassadorCreateManyInput[] = [];

  for (let i = 0; i < AMBASSADOR_COUNT; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    let email = faker.internet.email({ firstName, lastName }).toLowerCase();
    while (usedEmails.has(email)) email = `${i}.${email}`;
    usedEmails.add(email);

    let slug = `${faker.helpers.slugify(`${firstName}-${lastName}`).toLowerCase()}-${faker.string.alphanumeric(4).toLowerCase()}`;
    while (usedSlugs.has(slug)) slug = `${slug}${faker.string.alphanumeric(2).toLowerCase()}`;
    usedSlugs.add(slug);

    const status = faker.helpers.weightedArrayElement([
      { value: "ACTIVE" as const, weight: 70 },
      { value: "PENDING" as const, weight: 15 },
      { value: "INACTIVE" as const, weight: 10 },
      { value: "REJECTED" as const, weight: 5 },
    ]);

    ambassadorData.push({
      merchantId: merchant.id,
      name: `${firstName} ${lastName}`,
      email,
      status,
      tier: faker.helpers.arrayElement(TIERS),
      referralSlug: slug,
      tags: faker.helpers.arrayElements(TAG_POOL, { min: 0, max: 3 }),
      shopifyCustomerId: faker.datatype.boolean(0.4) ? String(faker.number.int({ min: 10 ** 12, max: 10 ** 13 })) : null,
      createdAt: faker.date.past({ years: 1.5 }),
    });
  }

  // Chunked inserts to stay friendly with the transaction pooler.
  for (let i = 0; i < ambassadorData.length; i += 250) {
    await prisma.ambassador.createMany({ data: ambassadorData.slice(i, i + 250) });
  }

  const ambassadors = await prisma.ambassador.findMany({
    where: { merchantId: merchant.id },
    select: { id: true, name: true, status: true, tier: true },
  });

  console.log("Creating referrals + ledgers…");
  const ledgerData: Prisma.LedgerEntryCreateManyInput[] = [];
  const referralData: Prisma.ReferralCreateManyInput[] = [];
  const discountData: Prisma.DiscountConfigCreateManyInput[] = [];
  let orderCounter = 5000;

  for (const ambassador of ambassadors) {
    if (ambassador.status !== "ACTIVE" && ambassador.status !== "INACTIVE") continue;

    // ~60% have a personal discount code (Phase 3 syncs these to Shopify).
    if (faker.datatype.boolean(0.6)) {
      const first = ambassador.name.split(" ")[0].replace(/[^a-zA-Z]/g, "").toUpperCase() || "AMB";
      discountData.push({
        merchantId: merchant.id,
        ambassadorId: ambassador.id,
        code: `${first}${faker.string.alphanumeric(4).toUpperCase()}`,
        rules: {
          productDiscounts: [],
          orderDiscount: { percent: 10 },
          shippingDiscount: null,
        },
        restrictToNewCustomers: faker.datatype.boolean(0.3),
      });
    }

    const orders = faker.number.int({ min: 0, max: 8 });
    const bps = { default: 1000, silver: 1200, gold: 1500, vip: 2000 }[ambassador.tier] ?? 1000;

    for (let o = 0; o < orders; o++) {
      const orderId = String(++orderCounter);
      const subtotal = faker.number.int({ min: 2500, max: 60000 });
      const commission = Math.floor((subtotal * bps + 5000) / 10000);
      const createdAt = faker.date.past({ years: 1 });
      const reversed = faker.datatype.boolean(0.06);

      referralData.push({
        merchantId: merchant.id,
        ambassadorId: ambassador.id,
        orderId,
        orderName: `#${orderId}`,
        attributionMethod: faker.helpers.arrayElement(["CODE", "LINK", "CUSTOMER"] as const),
        orderSubtotalCents: subtotal,
        orderTotalCents: Math.round(subtotal * 1.08),
        commissionCents: commission,
        currency: "USD",
        status: reversed ? "REVERSED" : faker.helpers.arrayElement(["APPROVED", "APPROVED", "APPROVED", "PENDING", "PAID"] as const),
        createdAt,
      });

      ledgerData.push({
        merchantId: merchant.id,
        ambassadorId: ambassador.id,
        type: "COMMISSION_EARNED" as LedgerType,
        amountCents: commission,
        currency: "USD",
        orderId,
        idempotencyKey: `commission:${orderId}`,
        memo: `Commission for order #${orderId}`,
        createdAt,
      });

      if (reversed) {
        ledgerData.push({
          merchantId: merchant.id,
          ambassadorId: ambassador.id,
          type: "COMMISSION_REVERSED" as LedgerType,
          amountCents: -commission,
          currency: "USD",
          orderId,
          idempotencyKey: `reversal:${orderId}`,
          memo: `Full refund on order #${orderId}`,
          createdAt: faker.date.soon({ days: 20, refDate: createdAt }),
        });
      }
    }

    // Store credit for ~35%.
    if (faker.datatype.boolean(0.35)) {
      const credit = faker.number.int({ min: 500, max: 10000 });
      ledgerData.push({
        merchantId: merchant.id,
        ambassadorId: ambassador.id,
        type: "CREDIT_ISSUED" as LedgerType,
        amountCents: credit,
        currency: "USD",
        idempotencyKey: `seed-credit:${ambassador.id}`,
        expiresAt: faker.date.future({ years: 0.5 }),
        memo: "Quarterly ambassador reward",
      });
      if (faker.datatype.boolean(0.4)) {
        ledgerData.push({
          merchantId: merchant.id,
          ambassadorId: ambassador.id,
          type: "CREDIT_REDEEMED" as LedgerType,
          amountCents: -faker.number.int({ min: 100, max: credit }),
          currency: "USD",
          idempotencyKey: `seed-redeem:${ambassador.id}`,
          memo: "Redeemed at checkout",
        });
      }
    }

    // Payouts for high earners.
    if (faker.datatype.boolean(0.2)) {
      ledgerData.push({
        merchantId: merchant.id,
        ambassadorId: ambassador.id,
        type: "PAYOUT" as LedgerType,
        amountCents: -faker.number.int({ min: 1000, max: 20000 }),
        currency: "USD",
        idempotencyKey: `seed-payout:${ambassador.id}`,
        memo: "PayPal payout",
      });
    }
  }

  for (let i = 0; i < referralData.length; i += 250) {
    await prisma.referral.createMany({ data: referralData.slice(i, i + 250) });
  }
  for (let i = 0; i < ledgerData.length; i += 250) {
    await prisma.ledgerEntry.createMany({ data: ledgerData.slice(i, i + 250) });
  }
  for (let i = 0; i < discountData.length; i += 250) {
    await prisma.discountConfig.createMany({ data: discountData.slice(i, i + 250), skipDuplicates: true });
  }

  console.log("Creating email templates…");
  await prisma.emailTemplate.createMany({
    data: [
      {
        merchantId: merchant.id,
        name: "Store credit issued",
        trigger: "CREDIT_ISSUED",
        subject: "{{ first_name }}, you just earned {{ credit_balance | money }} in store credit 🎉",
        body: [
          "Hi {{ first_name }},",
          "",
          "You now have {{ credit_balance | money }} in store credit.",
          "Use it on the new {{ product('new-arrival').title }} and pay only {{ net_price('new-arrival') | money }} after your discounts.",
          "",
          "Your code: {{ discount_code }}",
        ].join("\n"),
      },
      {
        merchantId: merchant.id,
        name: "Credit expiring soon",
        trigger: "CREDIT_EXPIRING",
        subject: "{{ first_name }}, {{ credit_balance | money }} in credit expires in 7 days",
        body: "Hi {{ first_name }},\n\nDon't leave money on the table — {{ credit_balance | money }} of your store credit expires on {{ credit_expires_at | date }}.",
      },
      {
        merchantId: merchant.id,
        name: "We miss you",
        trigger: "INACTIVITY_30D",
        subject: "{{ first_name }}, your audience misses you",
        body: "Hi {{ first_name }},\n\nIt's been a month since your last referral. You have {{ pending_commission | money }} pending — share your link to keep the momentum.",
      },
    ],
  });

  const counts = await prisma.$transaction([
    prisma.ambassador.count({ where: { merchantId: merchant.id } }),
    prisma.referral.count({ where: { merchantId: merchant.id } }),
    prisma.ledgerEntry.count({ where: { merchantId: merchant.id } }),
  ]);
  console.log(`Done: ${counts[0]} ambassadors, ${counts[1]} referrals, ${counts[2]} ledger entries.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
