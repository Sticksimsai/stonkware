// Thin client for the Hypeware backend. All amounts are integer lamports.
export const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function parse<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (j as { error?: string }).error || `HTTP ${r.status}`);
  return j as T;
}

export const getJSON = <T,>(path: string) => fetch(API + path, { cache: "no-store" }).then((r) => parse<T>(r));
export const postJSON = <T,>(path: string, body: unknown) =>
  fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => parse<T>(r));
export const postForm = <T,>(path: string, fd: FormData) => fetch(API + path, { method: "POST", body: fd }).then((r) => parse<T>(r));

export const imageUrl = (companyId: string) => `${API}/api/image/${companyId}`;
export const shotUrl = (stepId: string) => `${API}/api/steps/${stepId}/image`;
// Explorer links follow the backend's cluster (set once /api/config loads).
let cluster: "devnet" | "mainnet-beta" = "mainnet-beta";
export const setCluster = (c?: "devnet" | "mainnet-beta") => { if (c) cluster = c; };
const q = () => (cluster === "devnet" ? "?cluster=devnet" : "");
export const solscanTx = (sig: string | null) => (sig && !sig.startsWith("mock") ? `https://solscan.io/tx/${sig}${q()}` : null);
export const solscanAccount = (addr: string) => `https://solscan.io/account/${addr}${q()}`;
