import { useCallback, useState } from "react";
import {
  json,
  unstable_composeUploadHandlers,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams, useSubmit, useNavigation, useFetcher } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  ChoiceList,
  Filters,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Pagination,
  Text,
  useIndexResourceState,
} from "@shopify/polaris";
import type { AmbassadorStatus, Prisma } from "@prisma/client";
import { formatCents } from "@ascend/shared";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { requireMerchantByShop } from "../lib/merchant.server";
import { getBalances } from "../lib/balances.server";
import { enqueue, QUEUES } from "../lib/queue.server";
import { uploadImportCsv } from "../lib/supabase.server";

const PAGE_SIZE = 50;
const STATUSES: AmbassadorStatus[] = ["PENDING", "ACTIVE", "INACTIVE", "REJECTED"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await requireMerchantByShop(session.shop);

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const status = url.searchParams.getAll("status").filter((s) => STATUSES.includes(s as AmbassadorStatus));
  const tier = url.searchParams.get("tier")?.trim() ?? "";
  const tag = url.searchParams.get("tag")?.trim() ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));

  const where: Prisma.AmbassadorWhereInput = {
    merchantId: merchant.id,
    ...(query
      ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }] }
      : {}),
    ...(status.length ? { status: { in: status as AmbassadorStatus[] } } : {}),
    ...(tier ? { tier } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
  };

  const [total, ambassadors, imports] = await Promise.all([
    prisma.ambassador.count({ where }),
    prisma.ambassador.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.importJob.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
  ]);

  const balances = await getBalances(ambassadors.map((a) => a.id));

  return json({
    currency: merchant.currency,
    page,
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    imports: imports.map((i) => ({
      id: i.id,
      filename: i.filename,
      status: i.status,
      created: i.created,
      duplicates: i.duplicates,
      totalRows: i.totalRows,
      failReason: i.failReason,
    })),
    ambassadors: ambassadors.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      status: a.status,
      tier: a.tier,
      tags: a.tags,
      referralSlug: a.referralSlug,
      creditCents: balances.get(a.id)?.creditCents ?? 0,
      commissionPendingCents: balances.get(a.id)?.commissionPendingCents ?? 0,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await requireMerchantByShop(session.shop);

  const contentType = request.headers.get("content-type") ?? "";

  // ── CSV import: store file in Supabase Storage, then queue the parse job ──
  if (contentType.includes("multipart/form-data")) {
    const uploadHandler = unstable_composeUploadHandlers(
      unstable_createMemoryUploadHandler({ maxPartSize: 10 * 1024 * 1024 }),
    );
    const formData = await unstable_parseMultipartFormData(request, uploadHandler);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return json({ error: "Choose a CSV file to import." }, { status: 400 });
    }
    const content = await file.text();
    const storagePath = await uploadImportCsv(merchant.id, file.name || "import.csv", content);
    const importJob = await prisma.importJob.create({
      data: { merchantId: merchant.id, filename: file.name || "import.csv", storagePath },
    });
    await enqueue(QUEUES.imports, { type: "csv_import", importJobId: importJob.id });
    return json({ ok: true, importJobId: importJob.id });
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const ids = String(formData.get("ids") || "")
    .split(",")
    .filter(Boolean);
  if (ids.length === 0) return json({ error: "No ambassadors selected." }, { status: 400 });

  const scoped = { id: { in: ids }, merchantId: merchant.id };
  switch (intent) {
    case "activate":
      await prisma.ambassador.updateMany({ where: scoped, data: { status: "ACTIVE" } });
      break;
    case "deactivate":
      await prisma.ambassador.updateMany({ where: scoped, data: { status: "INACTIVE" } });
      break;
    case "reject":
      await prisma.ambassador.updateMany({ where: scoped, data: { status: "REJECTED" } });
      break;
    case "add-tag": {
      const tagValue = String(formData.get("tag") || "").trim();
      if (tagValue) {
        const targets = await prisma.ambassador.findMany({ where: scoped, select: { id: true, tags: true } });
        for (const t of targets) {
          if (!t.tags.includes(tagValue)) {
            await prisma.ambassador.update({ where: { id: t.id }, data: { tags: [...t.tags, tagValue] } });
          }
        }
      }
      break;
    }
    default:
      return json({ error: `Unknown action: ${intent}` }, { status: 400 });
  }
  return json({ ok: true });
};

const statusTone = (status: string) =>
  status === "ACTIVE" ? ("success" as const) : status === "PENDING" ? ("attention" as const) : status === "REJECTED" ? ("critical" as const) : undefined;

export default function AmbassadorsIndex() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
  const importFetcher = useFetcher<{ ok?: boolean; error?: string }>();

  const [importOpen, setImportOpen] = useState(false);
  const [queryValue, setQueryValue] = useState(searchParams.get("q") ?? "");

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(data.ambassadors);

  const applyParam = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams);
      params.delete("page");
      mutate(params);
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const runBulk = (intent: string) => {
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("ids", selectedResources.join(","));
    submit(formData, { method: "post" });
    clearSelection();
  };

  const statusFilterValue = searchParams.getAll("status");

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          allowMultiple
          choices={STATUSES.map((s) => ({ label: s, value: s }))}
          selected={statusFilterValue}
          onChange={(value) =>
            applyParam((params) => {
              params.delete("status");
              value.forEach((v) => params.append("status", v));
            })
          }
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = statusFilterValue.map((v) => ({
    key: `status-${v}`,
    label: `Status: ${v}`,
    onRemove: () =>
      applyParam((params) => {
        const rest = params.getAll("status").filter((s) => s !== v);
        params.delete("status");
        rest.forEach((s) => params.append("status", s));
      }),
  }));

  return (
    <Page
      title="Ambassadors"
      subtitle={`${data.total} total`}
      primaryAction={{ content: "Add ambassador", onAction: () => navigate("/app/ambassadors/new") }}
      secondaryActions={[{ content: "Import CSV", onAction: () => setImportOpen(true) }]}
    >
      <BlockStack gap="400">
        {data.imports.some((i) => i.status === "QUEUED" || i.status === "PROCESSING") && (
          <Card>
            <Text as="p" tone="subdued">
              An import is processing in the background — it will appear here when finished.
            </Text>
          </Card>
        )}
        {data.imports
          .filter((i) => i.status === "COMPLETED" || i.status === "FAILED")
          .slice(0, 1)
          .map((i) => (
            <Card key={i.id}>
              <Text as="p" tone={i.status === "FAILED" ? "critical" : "subdued"}>
                {i.status === "FAILED"
                  ? `Last import (${i.filename}) failed: ${i.failReason}`
                  : `Last import (${i.filename}): ${i.created} created, ${i.duplicates} duplicates skipped, ${i.totalRows} rows.`}
              </Text>
            </Card>
          ))}

        <Card padding="0">
          <Filters
            queryValue={queryValue}
            queryPlaceholder="Search name or email"
            filters={filters}
            appliedFilters={appliedFilters}
            onQueryChange={(value) => {
              setQueryValue(value);
            }}
            onQueryClear={() => {
              setQueryValue("");
              applyParam((params) => params.delete("q"));
            }}
            onClearAll={() => {
              setQueryValue("");
              setSearchParams(new URLSearchParams());
            }}
            onQueryBlur={() => applyParam((params) => (queryValue ? params.set("q", queryValue) : params.delete("q")))}
          />
          <IndexTable
            resourceName={{ singular: "ambassador", plural: "ambassadors" }}
            itemCount={data.ambassadors.length}
            selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
            onSelectionChange={handleSelectionChange}
            loading={navigation.state === "loading"}
            promotedBulkActions={[
              { content: "Approve / activate", onAction: () => runBulk("activate") },
              { content: "Deactivate", onAction: () => runBulk("deactivate") },
              { content: "Reject", onAction: () => runBulk("reject") },
            ]}
            headings={[
              { title: "Name" },
              { title: "Email" },
              { title: "Status" },
              { title: "Tier" },
              { title: "Tags" },
              { title: "Credit" },
              { title: "Pending commission" },
            ]}
          >
            {data.ambassadors.map((a, index) => (
              <IndexTable.Row
                id={a.id}
                key={a.id}
                position={index}
                selected={selectedResources.includes(a.id)}
                onClick={() => navigate(`/app/ambassadors/${a.id}`)}
              >
                <IndexTable.Cell>
                  <Text as="span" fontWeight="semibold">
                    {a.name}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>{a.email}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>{a.tier}</IndexTable.Cell>
                <IndexTable.Cell>{a.tags.join(", ")}</IndexTable.Cell>
                <IndexTable.Cell>{formatCents(a.creditCents, data.currency)}</IndexTable.Cell>
                <IndexTable.Cell>{formatCents(a.commissionPendingCents, data.currency)}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
          <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
            <Pagination
              hasPrevious={data.page > 1}
              hasNext={data.page < data.pageCount}
              onPrevious={() => applyParamWithPage(searchParams, setSearchParams, data.page - 1)}
              onNext={() => applyParamWithPage(searchParams, setSearchParams, data.page + 1)}
              label={`Page ${data.page} of ${data.pageCount}`}
            />
          </div>
        </Card>
      </BlockStack>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import ambassadors from CSV">
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Upload a CSV with columns: <code>name, email, tier, tags, referral_slug, shopify_customer_id</code>.
              Only <code>email</code> is required. Rows are deduplicated by email; parsing runs as a background job.
            </Text>
            <importFetcher.Form method="post" encType="multipart/form-data">
              <InlineStack gap="300" blockAlign="center">
                <input type="file" name="file" accept=".csv,text/csv" required />
                <Button submit loading={importFetcher.state !== "idle"} variant="primary">
                  Upload &amp; import
                </Button>
              </InlineStack>
            </importFetcher.Form>
            {importFetcher.data?.error && (
              <Text as="p" tone="critical">
                {importFetcher.data.error}
              </Text>
            )}
            {importFetcher.data?.ok && (
              <Text as="p" tone="success">
                Import queued — results will appear on this page shortly.
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function applyParamWithPage(
  searchParams: URLSearchParams,
  setSearchParams: (p: URLSearchParams) => void,
  page: number,
) {
  const params = new URLSearchParams(searchParams);
  params.set("page", String(page));
  setSearchParams(params);
}
