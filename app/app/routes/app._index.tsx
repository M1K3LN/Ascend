import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Card,
  Grid,
  IndexTable,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { formatCents } from "@ascend/shared";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { requireMerchantByShop } from "../lib/merchant.server";
import { getMerchantTotals } from "../lib/balances.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await requireMerchantByShop(session.shop);

  const [ambassadorCounts, referralCount, recentReferrals, totals] = await Promise.all([
    prisma.ambassador.groupBy({
      by: ["status"],
      where: { merchantId: merchant.id },
      _count: { _all: true },
    }),
    prisma.referral.count({ where: { merchantId: merchant.id } }),
    prisma.referral.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { ambassador: { select: { name: true } } },
    }),
    getMerchantTotals(merchant.id),
  ]);

  const counts = Object.fromEntries(ambassadorCounts.map((c) => [c.status, c._count._all]));
  const revenueAttributedCents = await prisma.referral.aggregate({
    where: { merchantId: merchant.id, status: { not: "REVERSED" } },
    _sum: { orderTotalCents: true },
  });

  return json({
    currency: merchant.currency,
    counts: {
      active: counts.ACTIVE ?? 0,
      pending: counts.PENDING ?? 0,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    },
    referralCount,
    revenueAttributedCents: revenueAttributedCents._sum.orderTotalCents ?? 0,
    totals,
    recentReferrals: recentReferrals.map((r) => ({
      id: r.id,
      orderName: r.orderName ?? r.orderId,
      ambassadorName: r.ambassador.name,
      method: r.attributionMethod,
      commissionCents: r.commissionCents,
      status: r.status,
      createdAt: r.createdAt,
    })),
  });
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" tone="subdued" variant="bodySm">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();

  return (
    <Page title="Overview">
      <BlockStack gap="500">
        <Grid columns={{ xs: 2, sm: 2, md: 4, lg: 4 }}>
          <Grid.Cell>
            <Stat label="Active ambassadors" value={String(data.counts.active)} />
          </Grid.Cell>
          <Grid.Cell>
            <Stat label="Pending applications" value={String(data.counts.pending)} />
          </Grid.Cell>
          <Grid.Cell>
            <Stat label="Revenue attributed" value={formatCents(data.revenueAttributedCents, data.currency)} />
          </Grid.Cell>
          <Grid.Cell>
            <Stat
              label="Commission payable"
              value={formatCents(data.totals.commissionPayableCents, data.currency)}
            />
          </Grid.Cell>
        </Grid>

        <Layout>
          <Layout.Section>
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "referral", plural: "referrals" }}
                itemCount={data.recentReferrals.length}
                selectable={false}
                headings={[
                  { title: "Order" },
                  { title: "Ambassador" },
                  { title: "Method" },
                  { title: "Commission" },
                  { title: "Status" },
                ]}
              >
                {data.recentReferrals.map((r, index) => (
                  <IndexTable.Row id={r.id} key={r.id} position={index}>
                    <IndexTable.Cell>{r.orderName}</IndexTable.Cell>
                    <IndexTable.Cell>{r.ambassadorName}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge>{r.method}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{formatCents(r.commissionCents, data.currency)}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={r.status === "REVERSED" ? "critical" : r.status === "APPROVED" ? "success" : undefined}>
                        {r.status}
                      </Badge>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
              {data.recentReferrals.length === 0 && (
                <div style={{ padding: 16 }}>
                  <Text as="p" tone="subdued">
                    No referrals yet. Share ambassador links or codes to start attributing orders —{" "}
                    <Link to="/app/ambassadors">manage ambassadors</Link>.
                  </Text>
                </div>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
