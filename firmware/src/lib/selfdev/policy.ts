// Which parts of Stonkware's code the flagship agent may change on its own.
// Default-deny: a pull request auto-merges only if EVERY changed file is in a SAFE area and NONE is
// PROTECTED. Anything else waits for a human to approve it on GitHub. This file itself is protected,
// so the agent can't loosen its own rules.
const B = () => (process.env.SELFDEV_BACKEND_DIR ?? "firmware").replace(/\/+$/, "");
const W = () => (process.env.SELFDEV_FRONTEND_DIR ?? "firmware-web").replace(/\/+$/, "");
const p = (dir: string, rest: string) => (dir ? `${dir}/${rest}` : rest);

/** Never merged automatically: money, keys, auth, payments, dependencies, deployment, and these rules. */
export function protectedGlobs() {
  const b = B(), w = W();
  return [
    ".github/**", "**/.env*", "**/*.pem", "**/*.key", "**/partner.json", "**/package.json", "**/package-lock.json", "**/next.config.*", "**/middleware.ts",
    p(b, "deploy/**"), p(b, "scripts/**"), p(b, "src/db/**"), p(b, "drizzle/**"), p(b, "src/instrumentation.ts"), p(b, "src/scheduler.ts"),
    // money, keys, chain
    p(b, "src/lib/signer.ts"), p(b, "src/lib/vault.ts"), p(b, "src/lib/treasury.ts"), p(b, "src/lib/policy.ts"), p(b, "src/lib/fees.ts"),
    p(b, "src/lib/launchpad.ts"), p(b, "src/lib/meteora.ts"), p(b, "src/lib/solana.ts"), p(b, "src/lib/env.ts"), p(b, "src/lib/price.ts"),
    p(b, "src/lib/flagship.ts"), p(b, "src/lib/vanity.ts"), p(b, "src/lib/merch.ts"), p(b, "src/lib/packages.ts"), p(b, "src/lib/creator-auth.ts"), p(b, "src/lib/http.ts"), p(b, "src/lib/tick.ts"),
    p(b, "src/lib/bots/**"), p(b, "src/lib/selfdev/**"), p(b, "src/lib/media/**"),
    // endpoints that move money, take payments, verify webhooks or change accounts
    p(b, "src/app/api/launch/**"), p(b, "src/app/api/orders/**"), p(b, "src/app/api/hooks/**"), p(b, "src/app/api/dev/**"), p(b, "src/app/api/cron/**"),
    p(b, "src/app/api/companies/*/connect/**"), p(b, "src/app/api/packages/**"), p(b, "src/app/api/media/**"),
    // frontend: wallet transactions, API/RPC endpoints, payment and signing UIs
    p(w, "src/lib/tx.ts"), p(w, "src/lib/api.ts"), p(w, "src/lib/config.tsx"), p(w, "src/components/Providers.tsx"), p(w, "src/components/WalletButton.tsx"),
    p(w, "src/components/Abilities.tsx"), p(w, "src/app/launch/**"), p(w, "src/app/c/*/BuyOffer.tsx"),
  ];
}

/** Where the agent may ship on its own: the website, docs, and its own tools/prompts. */
export function safeGlobs() {
  const b = B(), w = W();
  return [
    p(w, "src/**"), p(w, "public/**"),
    p(b, "src/lib/agent/**"), p(b, "src/lib/models.ts"), p(b, "src/components/**"), p(b, "docs/**"),
    "**/*.md",
  ];
}

const cache = new Map<string, RegExp>();
export function globToRegExp(glob: string) {
  let re = cache.get(glob);
  if (re) return re;
  let s = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      // "**/" matches zero or more directories; a trailing "**" matches everything below
      if (glob[i + 2] === "/") { s += "(?:.*/)?"; i += 2; } else { s += ".*"; i++; }
    } else if (ch === "*") s += "[^/]*";
    else if ("\\^$+?.()|{}[]".includes(ch)) s += "\\" + ch;
    else s += ch;
  }
  re = new RegExp(`^${s}$`);
  cache.set(glob, re);
  return re;
}
const matches = (path: string, globs: string[]) => globs.some((g) => globToRegExp(g).test(path));

export function classify(paths: string[]) {
  const prot = protectedGlobs(), safe = safeGlobs();
  const protectedFiles = paths.filter((f) => matches(f, prot));
  const outside = paths.filter((f) => !matches(f, prot) && !matches(f, safe));
  const lane: "auto" | "review" = protectedFiles.length || outside.length ? "review" : "auto";
  return { lane, protectedFiles: [...protectedFiles, ...outside] };
}

/** Content checks run on every proposed file, whatever the lane. */
export function scanContent(path: string, content: string) {
  const problems: string[] = [];
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) problems.push("contains a private key block");
  if (/\[(\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/.test(content)) problems.push("looks like a Solana secret key array");
  if (/(sk-or-|sk-ant-|ghp_|github_pat_|xox[bp]-)[A-Za-z0-9_-]{16,}/.test(content)) problems.push("contains what looks like an API token");
  if (/\bVAULT_KEY\s*=\s*["']?[0-9a-f]{64}/i.test(content)) problems.push("contains a vault key");
  if (content.length > 300_000) problems.push("file too large (max 300k chars)");
  return problems.length ? `${path}: ${problems.join(", ")}` : null;
}
