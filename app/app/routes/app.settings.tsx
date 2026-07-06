import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { requireMerchantByShop } from "../lib/merchant.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await requireMerchantByShop(session.shop);
  const program = await prisma.program.findFirst({ where: { merchantId: merchant.id, isDefault: true } });
  const settings = (merchant.settings ?? {}) as Record<string, string>;

  return json({
    joinUrl: `${process.env.SHOPIFY_APP_URL || ""}/a/${merchant.shopSlug}/join`,
    program: program
      ? {
          commissionType: program.commissionType,
          percent: program.percentBps != null ? String(program.percentBps / 100) : "10",
          flat: program.flatCents != null ? String(program.flatCents / 100) : "5",
          tiersJson: program.tiers ? JSON.stringify(program.tiers, null, 2) : `{\n  "default": { "percentBps": 1000 },\n  "gold": { "percentBps": 1500 }\n}`,
          cookieWindowDays: String(program.cookieWindowDays),
          autoApproveAmbassadors: program.autoApproveAmbassadors,
          autoApproveReferrals: program.autoApproveReferrals,
        }
      : null,
    brand: {
      brandColor: settings.brandColor ?? "#4f46e5",
      joinHeadline: settings.joinHeadline ?? "Become an ambassador",
      joinDescription: settings.joinDescription ?? "",
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await requireMerchantByShop(session.shop);
  const formData = await request.formData();

  const commissionType = String(formData.get("commissionType") || "PERCENT");
  const percent = parseFloat(String(formData.get("percent") || "10"));
  const flat = parseFloat(String(formData.get("flat") || "0"));
  const cookieWindowDays = Math.max(1, Math.min(365, parseInt(String(formData.get("cookieWindowDays") || "30"), 10) || 30));

  let tiers: unknown = null;
  if (commissionType === "TIERED") {
    try {
      tiers = JSON.parse(String(formData.get("tiersJson") || "{}"));
      if (typeof tiers !== "object" || tiers === null || !("default" in (tiers as object))) {
        return json({ error: 'Tiered config must be a JSON object with a "default" key.' }, { status: 400 });
      }
    } catch {
      return json({ error: "Tiered config is not valid JSON." }, { status: 400 });
    }
  }

  const program = await prisma.program.findFirst({ where: { merchantId: merchant.id, isDefault: true } });
  const data = {
    commissionType: commissionType as "PERCENT" | "FLAT" | "TIERED",
    percentBps: Number.isFinite(percent) ? Math.round(percent * 100) : 1000,
    flatCents: Number.isFinite(flat) ? Math.round(flat * 100) : 0,
    tiers: tiers as object | undefined ?? undefined,
    cookieWindowDays,
    autoApproveAmbassadors: formData.get("autoApproveAmbassadors") === "on",
    autoApproveReferrals: formData.get("autoApproveReferrals") === "on",
  };
  if (program) {
    await prisma.program.update({ where: { id: program.id }, data });
  } else {
    await prisma.program.create({ data: { ...data, merchantId: merchant.id, isDefault: true } });
  }

  await prisma.merchant.update({
    where: { id: merchant.id },
    data: {
      settings: {
        ...((merchant.settings ?? {}) as object),
        brandColor: String(formData.get("brandColor") || "#4f46e5"),
        joinHeadline: String(formData.get("joinHeadline") || "Become an ambassador"),
        joinDescription: String(formData.get("joinDescription") || ""),
      },
    },
  });

  return json({ ok: true });
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { ok?: boolean; error?: string } | undefined;
  const navigation = useNavigation();
  const p = data.program;

  const [commissionType, setCommissionType] = useState(p?.commissionType ?? "PERCENT");
  const [percent, setPercent] = useState(p?.percent ?? "10");
  const [flat, setFlat] = useState(p?.flat ?? "5");
  const [tiersJson, setTiersJson] = useState(p?.tiersJson ?? "{}");
  const [cookieWindowDays, setCookieWindowDays] = useState(p?.cookieWindowDays ?? "30");
  const [autoApproveAmbassadors, setAutoApproveAmbassadors] = useState(p?.autoApproveAmbassadors ?? false);
  const [autoApproveReferrals, setAutoApproveReferrals] = useState(p?.autoApproveReferrals ?? true);
  const [brandColor, setBrandColor] = useState(data.brand.brandColor);
  const [joinHeadline, setJoinHeadline] = useState(data.brand.joinHeadline);
  const [joinDescription, setJoinDescription] = useState(data.brand.joinDescription);

  return (
    <Page title="Settings">
      <Form method="post">
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {actionData?.ok && <Banner tone="success" title="Settings saved" />}
              {actionData?.error && <Banner tone="critical" title={actionData.error} />}

              <Card>
                <FormLayout>
                  <Text as="h2" variant="headingMd">
                    Commission program
                  </Text>
                  <Select
                    label="Commission structure"
                    name="commissionType"
                    options={[
                      { label: "Percentage of order subtotal", value: "PERCENT" },
                      { label: "Flat amount per order", value: "FLAT" },
                      { label: "Tiered (by ambassador tier)", value: "TIERED" },
                    ]}
                    value={commissionType}
                    onChange={(v) => setCommissionType(v as typeof commissionType)}
                  />
                  {commissionType === "PERCENT" && (
                    <TextField label="Commission %" name="percent" type="number" value={percent} onChange={setPercent} suffix="%" autoComplete="off" />
                  )}
                  {commissionType === "FLAT" && (
                    <TextField label="Flat commission" name="flat" type="number" value={flat} onChange={setFlat} prefix="$" autoComplete="off" />
                  )}
                  {commissionType === "TIERED" && (
                    <TextField
                      label="Tier rates (JSON)"
                      name="tiersJson"
                      value={tiersJson}
                      onChange={setTiersJson}
                      multiline={6}
                      autoComplete="off"
                      helpText='Keys are ambassador tiers; values like {"percentBps": 1500} or {"flatCents": 2500}. "default" is required.'
                    />
                  )}
                  <TextField
                    label="Referral cookie window (days)"
                    name="cookieWindowDays"
                    type="number"
                    value={cookieWindowDays}
                    onChange={setCookieWindowDays}
                    autoComplete="off"
                  />
                  <Checkbox
                    label="Auto-approve new ambassador applications"
                    checked={autoApproveAmbassadors}
                    onChange={setAutoApproveAmbassadors}
                    name="autoApproveAmbassadors"
                  />
                  <Checkbox
                    label="Auto-approve referrals (commission counted immediately)"
                    checked={autoApproveReferrals}
                    onChange={setAutoApproveReferrals}
                    name="autoApproveReferrals"
                  />
                </FormLayout>
              </Card>

              <Card>
                <FormLayout>
                  <Text as="h2" variant="headingMd">
                    Registration page
                  </Text>
                  <Text as="p" tone="subdued">
                    Public join page: <a href={data.joinUrl} target="_blank" rel="noreferrer">{data.joinUrl}</a>
                  </Text>
                  <TextField label="Headline" name="joinHeadline" value={joinHeadline} onChange={setJoinHeadline} autoComplete="off" />
                  <TextField label="Description" name="joinDescription" value={joinDescription} onChange={setJoinDescription} multiline={3} autoComplete="off" />
                  <TextField label="Brand color" name="brandColor" value={brandColor} onChange={setBrandColor} autoComplete="off" helpText="Hex color, e.g. #4f46e5" />
                </FormLayout>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Email sending domain
                  </Text>
                  <Text as="p" tone="subdued">
                    Sending-domain verification (SPF/DKIM/DMARC) ships in Phase 2 — this is where the DNS setup flow will live.
                  </Text>
                </BlockStack>
              </Card>

              <BlockStack inlineAlign="start">
                <Button submit variant="primary" loading={navigation.state === "submitting"}>
                  Save settings
                </Button>
              </BlockStack>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Form>
    </Page>
  );
}
