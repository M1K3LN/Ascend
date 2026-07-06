import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import { Badge, BlockStack, Button, Card, DataTable, InlineStack, Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueue, isKnownQueue } from "../lib/queue.server";

/** Admin view of the async machinery: dead letters, recent webhooks, GDPR requests. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const [deadLetters, recentWebhooks, gdprRequests] = await Promise.all([
    prisma.deadLetter.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 20 }),
    prisma.gdprRequest.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  return json({
    deadLetters: deadLetters.map((d) => ({
      id: d.id,
      queue: d.queue,
      error: d.error,
      attempts: d.attempts,
      createdAt: d.createdAt,
      payload: JSON.stringify(d.payload).slice(0, 200),
    })),
    recentWebhooks: recentWebhooks.map((w) => ({
      id: w.id,
      topic: w.topic,
      shop: w.shop,
      receivedAt: w.receivedAt,
      processed: Boolean(w.processedAt),
    })),
    gdprRequests: gdprRequests.map((g) => ({
      id: g.id,
      type: g.type,
      shop: g.shop,
      status: g.status,
      createdAt: g.createdAt,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const id = String(formData.get("id") || "");

  const deadLetter = await prisma.deadLetter.findUnique({ where: { id } });
  if (!deadLetter) return json({ error: "Dead letter not found" }, { status: 404 });

  if (intent === "requeue") {
    if (isKnownQueue(deadLetter.queue)) {
      await enqueue(deadLetter.queue, deadLetter.payload);
    }
    await prisma.deadLetter.delete({ where: { id } });
  } else if (intent === "discard") {
    await prisma.deadLetter.delete({ where: { id } });
  }
  return json({ ok: true });
};

export default function Jobs() {
  const data = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const act = (intent: string, id: string) => {
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("id", id);
    submit(formData, { method: "post" });
  };

  return (
    <Page title="Background jobs" subtitle="Queues drain every minute via Vercel Cron → pgmq">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Dead-letter queue ({data.deadLetters.length})
            </Text>
            {data.deadLetters.length === 0 ? (
              <Text as="p" tone="subdued">
                No poisoned messages. 🎉
              </Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Queue", "Error", "Attempts", "Payload", "Actions"]}
                rows={data.deadLetters.map((d) => [
                  d.queue,
                  d.error.slice(0, 120),
                  String(d.attempts),
                  d.payload,
                  (
                    <InlineStack gap="200" key={d.id}>
                      <Button size="slim" onClick={() => act("requeue", d.id)}>
                        Requeue
                      </Button>
                      <Button size="slim" tone="critical" onClick={() => act("discard", d.id)}>
                        Discard
                      </Button>
                    </InlineStack>
                  ) as unknown as string,
                ])}
              />
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Recent webhooks
            </Text>
            <DataTable
              columnContentTypes={["text", "text", "text", "text"]}
              headings={["Topic", "Shop", "Received", "Status"]}
              rows={data.recentWebhooks.map((w) => [
                w.topic,
                w.shop,
                new Date(w.receivedAt).toLocaleString(),
                (w.processed ? <Badge tone="success" key={w.id}>processed</Badge> : <Badge key={w.id}>queued</Badge>) as unknown as string,
              ])}
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              GDPR requests
            </Text>
            {data.gdprRequests.length === 0 ? (
              <Text as="p" tone="subdued">
                None received.
              </Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text"]}
                headings={["Type", "Shop", "Status", "Received"]}
                rows={data.gdprRequests.map((g) => [g.type, g.shop, g.status, new Date(g.createdAt).toLocaleString()])}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
