import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  DataTable,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { computeBalances, formatCents } from "@ascend/shared";
import type { AmbassadorStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { requireMerchantByShop } from "../lib/merchant.server";
import { eraseAmbassador } from "../lib/tenant-erasure.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await requireMerchantByShop(session.shop);

  const ambassador = await prisma.ambassador.findFirst({
    where: { id: params.id, merchantId: merchant.id },
    include: {
      ledgerEntries: { orderBy: { createdAt: "asc" } },
      referrals: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!ambassador) throw new Response("Not found", { status: 404 });

  const balances = computeBalances(
    ambassador.ledgerEntries.map((e) => ({ type: e.type, amountCents: e.amountCents })),
  );

  // Running balance for the ledger view (append-only ordering).
  let running = 0;
  const ledger = ambassador.ledgerEntries
    .map((e) => {
      running += e.amountCents;
      return {
        id: e.id,
        createdAt: e.createdAt,
        type: e.type,
        amountCents: e.amountCents,
        runningCents: running,
        memo: e.memo,
        orderId: e.orderId,
      };
    })
    .reverse();

  const appUrl = process.env.SHOPIFY_APP_URL || "";

  return json({
    currency: merchant.currency,
    shopSlug: merchant.shopSlug,
    referralUrl: `${appUrl}/a/${merchant.shopSlug}/r/${ambassador.referralSlug}`,
    ambassador: {
      id: ambassador.id,
      name: ambassador.name,
      email: ambassador.email,
      status: ambassador.status,
      tier: ambassador.tier,
      tags: ambassador.tags,
      referralSlug: ambassador.referralSlug,
      shopifyCustomerId: ambassador.shopifyCustomerId,
      createdAt: ambassador.createdAt,
    },
    balances,
    ledger,
    referrals: ambassador.referrals.map((r) => ({
      id: r.id,
      orderName: r.orderName ?? r.orderId,
      method: r.attributionMethod,
      commissionCents: r.commissionCents,
      status: r.status,
      createdAt: r.createdAt,
    })),
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await requireMerchantByShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "delete") {
    await eraseAmbassador(merchant.id, params.id!);
    return redirect("/app/ambassadors");
  }

  const statusByIntent: Record<string, AmbassadorStatus> = {
    activate: "ACTIVE",
    deactivate: "INACTIVE",
    reject: "REJECTED",
  };
  const status = statusByIntent[intent];
  if (status) {
    await prisma.ambassador.updateMany({ where: { id: params.id, merchantId: merchant.id }, data: { status } });
  }
  return json({ ok: true });
};

export default function AmbassadorDetail() {
  const data = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const a = data.ambassador;

  const act = (intent: string) => {
    if (intent === "delete" && !confirm("Delete this ambassador? Ledger history will be removed.")) return;
    const formData = new FormData();
    formData.set("intent", intent);
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title={a.name}
      subtitle={a.email}
      backAction={{ url: "/app/ambassadors" }}
      titleMetadata={<Badge tone={a.status === "ACTIVE" ? "success" : a.status === "PENDING" ? "attention" : undefined}>{a.status}</Badge>}
      secondaryActions={[
        ...(a.status !== "ACTIVE" ? [{ content: "Approve / activate", onAction: () => act("activate") }] : []),
        ...(a.status === "ACTIVE" ? [{ content: "Deactivate", onAction: () => act("deactivate") }] : []),
        ...(a.status === "PENDING" ? [{ content: "Reject", onAction: () => act("reject") }] : []),
        { content: "Delete", destructive: true, onAction: () => act("delete") },
      ]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <InlineGrid columns={3} gap="400">
              <Card>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Store credit
                  </Text>
                  <Text as="p" variant="headingLg">
                    {formatCents(data.balances.creditCents, data.currency)}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Pending commission
                  </Text>
                  <Text as="p" variant="headingLg">
                    {formatCents(data.balances.commissionPendingCents, data.currency)}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Lifetime commission
                  </Text>
                  <Text as="p" variant="headingLg">
                    {formatCents(data.balances.lifetimeCommissionCents, data.currency)}
                  </Text>
                </BlockStack>
              </Card>
            </InlineGrid>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Ledger
                </Text>
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "numeric", "text"]}
                  headings={["Date", "Type", "Amount", "Running balance", "Memo"]}
                  rows={data.ledger.map((e) => [
                    new Date(e.createdAt).toLocaleString(),
                    e.type,
                    formatCents(e.amountCents, data.currency),
                    formatCents(e.runningCents, data.currency),
                    e.memo ?? "",
                  ])}
                />
                {data.ledger.length === 0 && (
                  <Text as="p" tone="subdued">
                    No ledger entries yet.
                  </Text>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Referrals
                </Text>
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "text", "text"]}
                  headings={["Order", "Method", "Commission", "Status", "Date"]}
                  rows={data.referrals.map((r) => [
                    r.orderName,
                    r.method,
                    formatCents(r.commissionCents, data.currency),
                    r.status,
                    new Date(r.createdAt).toLocaleDateString(),
                  ])}
                />
                {data.referrals.length === 0 && (
                  <Text as="p" tone="subdued">
                    No attributed orders yet.
                  </Text>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Profile
              </Text>
              <BlockStack gap="200">
                <Text as="p">
                  <strong>Tier:</strong> {a.tier}
                </Text>
                <Text as="p">
                  <strong>Tags:</strong> {a.tags.length ? a.tags.join(", ") : "—"}
                </Text>
                <Text as="p">
                  <strong>Shopify customer:</strong> {a.shopifyCustomerId ?? "not linked"}
                </Text>
                <Text as="p">
                  <strong>Joined:</strong> {new Date(a.createdAt).toLocaleDateString()}
                </Text>
              </BlockStack>
              <Text as="h3" variant="headingSm">
                Referral link
              </Text>
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  <Text as="span" variant="bodySm">
                    {data.referralUrl}
                  </Text>
                </div>
                <Button onClick={() => navigator.clipboard.writeText(data.referralUrl)} size="slim">
                  Copy
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
