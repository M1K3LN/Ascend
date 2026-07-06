import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return json({ showForm: Boolean(login) });
};

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: 640, margin: "10vh auto", padding: 24 }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Ascend</h1>
      <p style={{ color: "#555", fontSize: 16 }}>
        Enterprise ambassador &amp; affiliate marketing for Shopify — unlimited deliverable email,
        live-data personalization, and one code with multiple discounts.
      </p>
      {showForm && (
        <Form method="post" action="/auth/login" style={{ display: "flex", gap: 8, marginTop: 24 }}>
          <input
            type="text"
            name="shop"
            placeholder="my-shop-domain.myshopify.com"
            style={{ flex: 1, padding: "8px 12px", border: "1px solid #ccc", borderRadius: 8 }}
          />
          <button type="submit" style={{ padding: "8px 16px", borderRadius: 8 }}>
            Log in
          </button>
        </Form>
      )}
    </div>
  );
}
