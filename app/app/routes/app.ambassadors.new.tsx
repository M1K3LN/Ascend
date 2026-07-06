import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { BlockStack, Button, Card, FormLayout, Page, Select, Text, TextField } from "@shopify/polaris";
import { useState } from "react";
import { generateReferralSlug } from "@ascend/shared";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { requireMerchantByShop } from "../lib/merchant.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await requireMerchantByShop(session.shop);
  const formData = await request.formData();

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const tier = String(formData.get("tier") || "default").trim() || "default";
  const status = String(formData.get("status") || "ACTIVE");
  const tags = String(formData.get("tags") || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "A name and a valid email are required." }, { status: 400 });
  }

  try {
    const ambassador = await prisma.ambassador.create({
      data: {
        merchantId: merchant.id,
        name,
        email,
        tier,
        tags,
        status: status === "PENDING" ? "PENDING" : "ACTIVE",
        referralSlug: generateReferralSlug(name),
      },
    });
    return redirect(`/app/ambassadors/${ambassador.id}`);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return json({ error: "An ambassador with this email already exists." }, { status: 400 });
    }
    throw error;
  }
};

export default function NewAmbassador() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState("default");
  const [status, setStatus] = useState("ACTIVE");
  const [tags, setTags] = useState("");

  return (
    <Page title="Add ambassador" backAction={{ url: "/app/ambassadors" }} narrowWidth>
      <Card>
        <Form method="post">
          <FormLayout>
            {actionData?.error && (
              <Text as="p" tone="critical">
                {actionData.error}
              </Text>
            )}
            <TextField label="Name" name="name" value={name} onChange={setName} autoComplete="off" requiredIndicator />
            <TextField label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="off" requiredIndicator />
            <TextField label="Tier" name="tier" value={tier} onChange={setTier} autoComplete="off" helpText="Used by tiered commission programs (e.g. default, gold, vip)." />
            <Select
              label="Status"
              name="status"
              options={[
                { label: "Active", value: "ACTIVE" },
                { label: "Pending approval", value: "PENDING" },
              ]}
              value={status}
              onChange={setStatus}
            />
            <TextField label="Tags" name="tags" value={tags} onChange={setTags} autoComplete="off" helpText="Comma-separated." />
            <BlockStack inlineAlign="start">
              <Button submit variant="primary" loading={navigation.state === "submitting"}>
                Create ambassador
              </Button>
            </BlockStack>
          </FormLayout>
        </Form>
      </Card>
    </Page>
  );
}
