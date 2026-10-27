// Minimal GitHub REST client for the flagship agent's self-improvement loop.
// Needs a fine-grained token on ONE repo with: Contents (read/write), Pull requests (read/write),
// Checks (read), Metadata (read). Never the account's other repos.
const API = () => (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
export const repo = () => process.env.GITHUB_REPO || "";
export const baseBranch = () => process.env.GITHUB_BASE_BRANCH || "main";
export const githubEnabled = () => !!(process.env.GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(repo()));

async function gh<T>(path: string, init: RequestInit & { accept?: string } = {}): Promise<T> {
  const { accept, ...rest } = init;
  const go = () => fetch(`${API()}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: accept ?? "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "firmware-agent",
    },
    signal: AbortSignal.timeout(30_000),
  });
  // one retry on a network blip ("fetch failed"), never on an HTTP error
  const r = await go().catch(async () => { await new Promise((res) => setTimeout(res, 1500)); return go(); });
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 300);
    try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* raw */ }
    throw Object.assign(new Error(`github ${r.status}: ${msg}`), { status: r.status });
  }
  return (text ? JSON.parse(text) : null) as T;
}
const R = () => `/repos/${repo()}`;

export async function headSha(branch = baseBranch()) {
  return (await gh<{ object: { sha: string } }>(`${R()}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
}

let treeCache: { sha: string; files: { path: string; size: number }[] } | null = null;
export async function listFiles() {
  const sha = await headSha();
  if (treeCache?.sha === sha) return treeCache.files;
  const t = await gh<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(`${R()}/git/trees/${sha}?recursive=1`);
  const files = t.tree.filter((x) => x.type === "blob" && !/(^|\/)(node_modules|\.next)\//.test(x.path)).map((x) => ({ path: x.path, size: x.size ?? 0 }));
  treeCache = { sha, files };
  return files;
}

/** File content at a ref, or null if it doesn't exist. */
export async function readFile(path: string, ref = baseBranch()): Promise<string | null> {
  try {
    const f = await gh<{ content?: string; encoding?: string; size: number; sha: string; type: string }>(`${R()}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
    if (f.type !== "file") throw new Error(`${path} is not a file`);
    if (f.content && f.encoding === "base64") return Buffer.from(f.content, "base64").toString("utf8");
    const blob = await gh<{ content: string }>(`${R()}/git/blobs/${f.sha}`);
    return Buffer.from(blob.content, "base64").toString("utf8");
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/**
 * Search the server's own checkout (the code that's deployed = main, refreshed by auto-update). GitHub's code
 * search often has no index for new or private repos, so this is the primary search; GitHub is the fallback.
 */
export async function searchLocal(q: string, limit = 40): Promise<{ path: string; fragments: string[] }[] | null> {
  const { existsSync, readdirSync, readFileSync, realpathSync, statSync } = await import("fs");
  const { join, dirname, relative } = await import("path");
  let root = realpathSync(process.cwd());
  for (let i = 0; i < 3 && !existsSync(join(root, ".git")); i++) root = dirname(root);
  if (!existsSync(join(root, ".git"))) return null;
  const needle = q.toLowerCase();
  const out = new Map<string, string[]>();
  let count = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (count >= limit) return;
      if (name === "node_modules" || name === ".next" || name === ".git" || name.startsWith(".env") || name.endsWith(".db")) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) { walk(full); continue; }
      if (st.size > 400_000 || !/\.(tsx?|jsx?|mjs|cjs|css|md|json|sh|ya?ml|html|txt)$|^(Caddyfile|Dockerfile)$/.test(name)) continue;
      const lines = readFileSync(full, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (count >= limit || !l.toLowerCase().includes(needle)) return;
        const rel = relative(root, full);
        out.set(rel, [...(out.get(rel) ?? []), `${i + 1}: ${l.trim().slice(0, 160)}`]);
        count++;
      });
    }
  };
  walk(root);
  return [...out].map(([path, fragments]) => ({ path, fragments }));
}

export async function searchCode(q: string) {
  const local = await searchLocal(q).catch(() => null);
  if (local) return local;
  const r = await gh<{ items: { path: string; text_matches?: { fragment: string }[] }[] }>(`/search/code?q=${encodeURIComponent(`${q} repo:${repo()}`)}&per_page=20`, { accept: "application/vnd.github.text-match+json" });
  return r.items.map((i) => ({ path: i.path, fragments: (i.text_matches ?? []).map((m) => m.fragment).slice(0, 2) }));
}

/** Commit file changes (content = null deletes) on top of `parent`, and point `branch` at it. */
export async function commitFiles(branch: string, parent: string, files: { path: string; content: string | null }[], message: string, createBranch: boolean) {
  const base = await gh<{ tree: { sha: string } }>(`${R()}/git/commits/${parent}`);
  const tree = await gh<{ sha: string }>(`${R()}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: base.tree.sha, tree: files.map((f) => (f.content === null ? { path: f.path, mode: "100644", type: "blob", sha: null } : { path: f.path, mode: "100644", type: "blob", content: f.content })) }),
  });
  const commit = await gh<{ sha: string }>(`${R()}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }) });
  if (createBranch) await gh(`${R()}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) });
  else await gh(`${R()}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  return commit.sha;
}

export const openPull = (title: string, body: string, head: string) =>
  gh<{ number: number; html_url: string }>(`${R()}/pulls`, { method: "POST", body: JSON.stringify({ title, body, head, base: baseBranch() }) });

export const setLabels = (n: number, labels: string[]) => gh(`${R()}/issues/${n}/labels`, { method: "PUT", body: JSON.stringify({ labels }) });
export const comment = (n: number, body: string) => gh(`${R()}/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body }) });

export type Pull = { number: number; state: "open" | "closed"; merged: boolean; mergeable: boolean | null; head: { sha: string; ref: string }; additions: number; deletions: number; title: string };
export const getPull = (n: number) => gh<Pull>(`${R()}/pulls/${n}`);
export async function pullFiles(n: number) {
  const out: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await gh<{ filename: string; previous_filename?: string }[]>(`${R()}/pulls/${n}/files?per_page=100&page=${page}`);
    for (const f of r) { out.push(f.filename); if (f.previous_filename) out.push(f.previous_filename); }
    if (r.length < 100) break;
  }
  return out;
}

export type CheckRun = { name: string; status: string; conclusion: string | null; output?: { title?: string | null; summary?: string | null; text?: string | null }; html_url?: string };
export async function checks(sha: string) {
  const r = await gh<{ total_count: number; check_runs: CheckRun[] }>(`${R()}/commits/${sha}/check-runs?per_page=50`);
  return r.check_runs;
}

export const mergePull = (n: number, sha: string, title: string) =>
  gh(`${R()}/pulls/${n}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash", sha, commit_title: `${title} (#${n})` }) });
export const closePull = (n: number) => gh(`${R()}/pulls/${n}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
