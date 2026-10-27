// Minimal Higgsfield API client (https://docs.higgsfield.ai).
// Async model: submit → { request_id } → poll /requests/:id/status until a terminal status.
import { randomUUID } from "crypto";
import { env } from "../env";

const BASE = (process.env.HIGGSFIELD_API_URL || "https://api.higgsfield.ai").replace(/\/+$/, "");
export type HfStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
export type HfResult = { status: HfStatus; request_id: string; images?: { url: string }[]; video?: { url: string }; error?: string };

export const higgsfieldEnabled = () => !!(env.higgsfieldKeyId && env.higgsfieldKeySecret);

const headers = () => ({
  Authorization: `Key ${env.higgsfieldKeyId}:${env.higgsfieldKeySecret}`,
  "Content-Type": "application/json",
});

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(30_000) });
  const text = await r.text();
  let j: unknown = null;
  try { j = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) {
    const msg = (j as { detail?: unknown; error?: unknown; message?: unknown } | null);
    const detail = msg?.detail ?? msg?.error ?? msg?.message ?? text.slice(0, 300);
    throw Object.assign(new Error(`higgsfield ${r.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300)}`), { status: r.status });
  }
  return j as T;
}

/** Submit a generation. `endpoint` is the model path, e.g. "kling-video/v3.0/std/text-to-video". */
export async function submit(endpoint: string, body: Record<string, unknown>): Promise<{ request_id: string; status: HfStatus }> {
  const path = endpoint.replace(/^\/+/, "");
  return call(`${BASE}/${path}`, { method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": randomUUID() } });
}

export async function status(requestId: string): Promise<HfResult> {
  return call(`${BASE}/requests/${encodeURIComponent(requestId)}/status`);
}

export const isTerminal = (s: string) => s === "completed" || s === "failed" || s === "nsfw" || s === "canceled";
