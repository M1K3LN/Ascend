import { json } from "@remix-run/node";

export const loader = async () => json({ ok: true, service: "ascend", ts: new Date().toISOString() });
