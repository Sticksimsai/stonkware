# Building the Firmware frontend on Lovable

This file has **6 prompts to paste into Lovable, one at a time**. Wait for each to finish and check the preview before sending the next. They assume the backend from this repo is already running somewhere public, for example `https://api.firmware.xyz` on your droplet. While you're testing, a mock-mode backend works fine.

**Before prompt 1:**
1. In Lovable, create a new project and **upload the 3 images in `docs/brand/`** (`banner.jpg`, `logo.png` (transparent), `mark.png` (transparent)) into the chat. Ask Lovable to save them to `public/brand/`.
2. Add `docs/API.md` to the project as a file Lovable can read, or paste it in when a prompt says "see API.md".
3. On the backend, set `ALLOWED_ORIGINS` to include your Lovable URLs. The default `*.lovable.app,*.lovableproject.com` already covers previews. Add your custom domain later.

> Tip: if Lovable offers to add Supabase, say **no**. This app has its own backend.

---

## Prompt 1: foundation, design system, layout, home page

````
Build "Firmware", the frontend for a Solana launchpad where every token is a company run by an autonomous AI agent. There is NO Supabase and no local database: all data comes from my existing REST API. Use React + Vite + TypeScript + Tailwind + React Router + TanStack Query.

API
- Base URL from env var VITE_API_URL (default "http://localhost:3000"). Create src/lib/api.ts with a typed fetch helper: getJSON(path), postJSON(path, body), and error handling that reads {error} from JSON.
- All amounts are integer lamports (1 SOL = 1e9). Write helpers fmtSol(lamports, digits=3) → "0.123 SOL", short(addr) → "AbCd…WxYz", ago(date) → "5m ago".
- First call GET /api/config on load (cache it in a React Query hook useConfig). If config.mode === "mock", show a thin red top banner: "MOCK MODE · NO REAL TRANSACTIONS · FEES ARE SIMULATED".

DESIGN SYSTEM (very important — pixel-art / retro CRT, matching the uploaded banner and logo)
- Background #050404 with a halftone dot grid: background-image radial-gradient(rgba(239,233,217,.055) 1px, transparent 1.2px) at 6px 6px, plus a faint warm radial glow at the top. Add very subtle CRT scanlines with a fixed full-screen ::after overlay (repeating-linear-gradient, 3px period, pointer-events none).
- Colors (Tailwind theme): ink #050404, panel #0d0b09, raise #14110d, line #2a231b, mute #8c8170, soft #b3a993, cream #efe9d9 (primary), cream-dim #cfc6b0, cyan #00e8e5, lime #e3e63d, red #f73c4f.
- Fonts (npm @fontsource): "Silkscreen" for labels, buttons, nav (uppercase, letter-spacing .1em); "Pixelify Sans" bold for big headlines; "IBM Plex Mono" for all body text and numbers. No sans-serif anywhere.
- Glow: headings and key numbers use text-shadow 0 0 10px rgba(239,233,217,.45).
- NO rounded corners anywhere. Panels, inputs and buttons use "pixel notched" corners via clip-path: polygon(0 4px,4px 4px,4px 0,calc(100% - 4px) 0,calc(100% - 4px) 4px,100% 4px,100% calc(100% - 4px),calc(100% - 4px) calc(100% - 4px),calc(100% - 4px) 100%,4px 100%,4px calc(100% - 4px),0 calc(100% - 4px)). Borders are 2px solid #2a231b.
- Primary button: cream background, ink text, Silkscreen 12px uppercase, inset bottom shadow. Ghost button: raise background, 2px line border, cream text.
- Brand accent "LEDs": three 6px squares in cyan, lime, red (like the logo) next to small labels.
- Add this PixelIcon component exactly as given (pixel-art SVG icons drawn from character grids) and use it throughout:

```tsx
// Pixel-art icons in the Firmware brand style. Each icon is a grid: x = cream, c = cyan, l = lime, r = red.
const C: Record<string, string> = { x: "#efe9d9", c: "#00e8e5", l: "#e3e63d", r: "#f73c4f" };

export const ICONS = {
  search: ["..xxxx....", ".x....x...", "x......x..", "x..c...x..", "x......x..", ".x....x...", "..xxxxxx..", "......xxx.", ".......xxx", "........xx"],
  browser: ["xxxxxxxxxx", "x.r.l.c..x", "xxxxxxxxxx", "x........x", "x.xxxxx..x", "x........x", "x.xxx....x", "x........x", "xxxxxxxxxx"],
  click: ["x.......", "xx......", "x.x.....", "x..x....", "x...x...", "x....x..", "x..xxxx.", "x.x.....", "xx......", "x......c"],
  type: ["xxxxxxxxxx", "x........x", "x.x.x.x.lx", "x........x", "x.xxxxxx.x", "x........x", "xxxxxxxxxx"],
  code: ["......l....", "..x...x.x..", ".x...x...x.", "x....x....x", ".x..x....x.", "..x.x...x.."],
  doc: ["xxxxx...", "x...xx..", "x.xx.xx.", "x......x", "x.xxxx.x", "x......x", "x.xx..cx", "xxxxxxxx"],
  palette: [".xxxxxx..", "x......x.", "x.l..c..x", "x.......x", "x..r...x.", "x....xx..", ".x..x....", "..xx....."],
  cart: ["x.........", "xxxxxxxxxx", ".x......x.", ".x.c.l.rx.", ".xxxxxxxx.", "..........", "..x....x.."],
  check: ["........x", ".......xx", "x.....xx.", "xx...xx..", ".xx.xx...", "..xxx....", "...x....."],
  coin: ["..xxxxx..", ".x.....x.", "x..lll..x", "x..l....x", "x..lll..x", "x....l..x", "x..lll..x", ".x.....x.", "..xxxxx.."],
  flame: ["....x....", "...xx....", "..xxx.x..", "..xrxxx..", ".xrrrxxx.", ".xrlrrxx.", ".xxllrxx.", "..xxxxx.."],
  send: ["......x...", "......xx..", "xxxxxxxxx.", "xxxxxxxxxx", "xxxxxxxxx.", "......xx..", "......x..."],
  chat: ["xxxxxxxxx.", "x.......x.", "x.c.l.r.x.", "x.......x.", "xxxxxxxxx.", "..xx......", "..x......."],
  memory: ["..x.x.x..", ".xxxxxxx.", "xx.....xx", ".x.c.l.x.", "xx.....xx", ".xxxxxxx.", "..x.x.x.."],
  moon: ["...xxx...", "..xx.....", ".xx......", ".xx......", ".xx.....c", "..xx...x.", "...xxxx.."],
  stop: ["xxxxxxx", "x.....x", "x.xxx.x", "x.xxx.x", "x.xxx.x", "x.....x", "xxxxxxx"],
  calendar: [".x....x.", "xxxxxxxx", "x......x", "x.x.x.lx", "x......x", "x.x.x..x", "xxxxxxxx"],
  chart: ["........c", "......x..", "....x.x..", "..x.x.x..", "x.x.x.x..", "xxxxxxxxx"],
  flow: ["......rr", "......rr", "xxx...x.", "x.x..x..", "xxxxx...", "..x..xxx", "..x..x.x", ".....xxx"],
  research: ["xxxxxx...", "x....x...", "x.xx.x...", "x....xxx.", "x.xxx...x", "x....x.c.x", "xxxxx.x..x", "......xxx.", "........xx"],
  bolt: ["....xx", "...xx.", "..xx..", ".xxxxx", "...xx.", "..xx..", ".xx..."],
  error: ["...x...", "..xxx..", "..x.x..", ".xx.xx.", ".xxrxx.", "xxx.xxx", "xxxxxxx"],
  eye: ["..xxxxx..", ".x.....x.", "x...c...x", "x..ccc..x", "x...c...x", ".x.....x.", "..xxxxx.."],
} as const;

export type IconName = keyof typeof ICONS;

export default function PixelIcon({ name, size = 18, className = "", glow = true }: { name: IconName; size?: number; className?: string; glow?: boolean }) {
  const g = ICONS[name];
  const w = Math.max(...g.map((r) => r.length));
  const h = g.length;
  const rects: JSX.Element[] = [];
  g.forEach((row, y) =>
    row.split("").forEach((ch, x) => {
      if (C[ch]) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={C[ch]} />);
    }),
  );
  const scale = size / Math.max(w, h);
  return (
    <svg
      width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden
      className={`inline-block shrink-0 ${className}`}
      style={glow ? { filter: "drop-shadow(0 0 3px rgba(239,233,217,.45))" } : undefined}
    >
      {rects}
    </svg>
  );
}

/** Which icon to show for each agent tool. */
export const TOOL_ICON: Record<string, IconName> = {
  web_search: "search", open_url: "browser", click: "click", fill: "type", read_more: "doc",
  write_site_file: "code", read_site_file: "doc", list_site_files: "doc", delete_site_file: "code", set_tagline: "palette",
  create_offer: "cart", update_offer: "cart", deliver_order: "check", check_treasury: "coin", buyback: "flame",
  transfer_sol: "send", post_update: "chat", remember: "memory", sleep: "moon", end_shift: "stop",
};
```

LAYOUT
- Sticky header: logo image /brand/mark.png (34px, with a soft cream drop-shadow glow) + "FIRMWARE" in Silkscreen with glow; nav links Companies, How it works, Launch (active link cream with a cyan ▸); a live UTC clock; a Solana wallet connect button (styled as the primary button — wallet setup comes in prompt 3, use a placeholder button for now).
- Footer: small logo, "FIRMWARE · EVERY TOKEN IS A COMPANY", the three LEDs, and "Tokens are speculative and can go to zero. Nothing here is financial advice."

HOME PAGE (/)
1. Hero: full-width /brand/banner.jpg (max 1500px, centered, masked to fade at the bottom and left/right edges). Below it, centered: LEDs + label "AUTONOMOUS COMPANIES ON SOLANA", headline "Every token / is a company." (Pixelify Sans, 72px desktop, strong glow), subtext "Pick a mind — Claude, GPT, Gemini, Grok — and write the aim. Your token funds an AI agent from the first trade. It researches, builds its own website, sells and spends with full control. Watch it work, live.", buttons "▸ Launch a company" (primary → /launch) and "How it works" (ghost → /how).
2. Stats row (6 notched cards, icon + Silkscreen label + glowing number) from GET /api/stats: Companies (flow icon), Working now (eye), Actions (bolt), Site files (code), Creator fees (chart, fmtSol), Revenue (cart, fmtSol). Refetch every 15s.
3. "Working right now" (eye icon, blinking █ cursor after title) from GET /api/working, refetch every 5s: grid of cards, each with a 16:10 screenshot image (GET {API}/api/steps/{shot.id}/image) or "thinking█", a red "● LIVE" badge, company name + $TICKER, and the latest action in cyan mono (tool name + args). Card links to /c/{slug}. Empty state: "No agent is mid-shift right now."
4. Two columns: "Companies" table (from GET /api/companies, top 10; columns #, Company [avatar + name + $ticker + tagline], Mind [cyan], Creator fees, Revenue, Compute, Agent status) and "Latest moves" feed (GET /api/feed?limit=14, refetch 10s). Feed items: pixel icon by kind (ACTION bolt cream, POST chat cyan, DELIVERY check lime, TREASURY coin lime, SYSTEM flow mute), kind label, $TICKER link, ago, title, body (clamped), and a solscan link when sig is set and doesn't start with "mock".
5. "What one token does": 8 notched cards with big pixel icons: Aim (chat), Research (research), Build (code), Brand (palette), Sell (cart), Grow (chart), Operate (calendar), Decide (flow), each with a one-line description.

Avatars: if hasImage, <img src={API}/api/image/{id}> in a notched 2px border box; otherwise the ticker in Silkscreen.
Make it fully responsive (mobile: 2-column stats, stacked sections, no horizontal scroll).
````

---

## Prompt 2: Companies list + company page with the LIVE view

````
Add two pages. See API.md for exact response shapes.

/companies — title "Companies" (Pixelify Sans, glow), "N live. Ranked by creator fees + revenue.", then the same companies table as the home page with all rows.

/c/:slug — data from GET /api/companies/:slug (refetch every 10s).
- Header: avatar (72px), name + $TICKER, tagline, a meta row in mono 11px: memory icon + "mind · {modelLabel}" (cyan), "treasury {short} ↗" (links.treasury), links.trade "trade ↗" and links.chart "chart ↗" when present, "graduated · DAMM v2" in lime if company.migrated else "bonding curve · Meteora", "launched {ago}". Right side: primary button "▸ Visit its website" (opens company.websiteUrl) when websiteUrl is set.
- If status is FAILED show a red notched box with launchError.
- 6 stat cards: Treasury (coin, balanceLamports), Creator fees (chart), Revenue (cart), Compute (bolt, 4 digits), Delivered (check, ordersDelivered), Burned (flame, tokensBurned / 1e6 formatted).
- Section "Live · the agent at work" (eye icon) — the most important component, build it as <LiveView slug>:
  * Poll GET /api/companies/:slug/live every 2s using the algorithm in API.md (track runId + lastSeq; when run.id changes refetch with after=0&run=<id> and replace steps; otherwise append).
  * Status bar (2px border-bottom): "● WORKING" in cyan with a flickering dot when run.status==="RUNNING"; "SLEEPING" with moon icon when sleepingUntil is in the future; else "● IDLE". Then "started 1m ago" / "last shift 5m ago", "N actions" (count of TOOL steps), "browser · {run.browser}", and on the right "cost {costLamports/1e9 to 5 dp} SOL".
  * Two columns on desktop (screen 1.35fr | log 1fr), stacked on mobile.
  * Screen: a fake browser bar (raise bg, three LED squares red/lime/cyan, current URL in mono). Body 16:10 black: if RUNNING and run.liveUrl → <iframe src={liveUrl} sandbox="allow-same-origin allow-scripts" style={{pointerEvents:"none"}}>; else latest SHOT step as <img src={API}/api/steps/{id}/image> object-cover object-top; else centered logo (/brand/mark.png, 56px, 60% opacity) + "no browser activity yet". Red "● LIVE" badge top-left while running. Under it a filmstrip of the last 12 SHOT thumbnails (64x40, 2px border, active one cream); clicking pins it, with a "latest ↻" button to unpin.
  * Log (max-height 560px, auto-scroll to bottom when the user is near the bottom): THINK = left 2px cyan border, cream-dim 13px text, pre-wrap. TOOL = PixelIcon for the tool (mapping below) + tool name in cream with glow + args JSON in soft mono, truncated. RESULT = dim mono 11px indented, truncated to 220 chars with a "[more]" toggle. ERROR = same but red. SHOT = small clickable thumbnail. While running, end with "thinking█" (blinking). When finished show "SHIFT SUMMARY" label in lime + run.summary.
  * Tool → icon: web_search search, open_url browser, click click, fill type, read_more doc, write_site_file code, read_site_file doc, list_site_files doc, delete_site_file code, set_tagline palette, create_offer cart, update_offer cart, deliver_order check, check_treasury coin, buyback flame, transfer_sol send, post_update chat, remember memory, sleep moon, end_shift stop.
- Below, two columns:
  Left: "Offers" (cart) — one notched card per active offer (title, description, price in lime), each with a "Buy" button (buy flow comes in prompt 4; for now it can open an empty dialog). Empty: "The agent hasn't decided what to sell yet." Then "Website" (code) — a notched frame with a URL bar ("api-domain/s/slug", "N files") and an <iframe src={websiteUrl} sandbox="allow-scripts allow-popups"> 420px tall, white background. Then "Activity" (bolt) — the feed list.
  Right: "The aim" card (chat icon) with the aim text and "Set by the creator at launch. Everything else is decided by the agent."; if config.mode==="mock" a ghost button "Simulate fees + wake agent (mock)" → POST /api/dev/tick/{company.id}, show the result line. "Shifts" (calendar) list: status (running cyan / error red), steps, cost, ago, summary (3 lines). "Ledger" (coin): kind, signed amount (positive lime, negative cream-dim; BURN rows show tokens/1e6 + " tkn" in lime), ago with solscan link when sig is real.
````

---

## Prompt 3: wallet + launch page

````
Add Solana wallet support and the /launch page.

WALLET
- Install @solana/web3.js, @solana/wallet-adapter-react, @solana/wallet-adapter-react-ui, @solana/wallet-adapter-base, bs58, and vite-plugin-node-polyfills (configure it in vite.config.ts so Buffer/process work in the browser).
- Wrap the app in ConnectionProvider (endpoint = config.solanaRpcUrl, falling back to import.meta.env.VITE_SOLANA_RPC_URL), WalletProvider with wallets=[] and autoConnect (Phantom/Solflare/Backpack register via Wallet Standard), WalletModalProvider. Import the adapter UI css and restyle: .wallet-adapter-button → Silkscreen 12px, no border-radius, height 36px; trigger button cream bg + ink text + soft glow; modal → panel bg, 2px line border, no radius.
- Replace the header placeholder with WalletMultiButton.
- In mock mode, when no wallet is connected, use the placeholder address "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx" so the flow still works.

/launch
- Label with LEDs "LAUNCH", headline "Give a token a mind.", intro: "Name it, write the aim, choose the model. Firmware launches the coin on its Meteora bonding curve with the company's own treasury as creator. From then on an AI agent runs the business with full control, and everyone can watch it work."
- Left column, numbered sections with pixel icons ("01 TOKEN", "02 THE AIM", "03 THE MIND"):
  01 Token: name (max 32), ticker (uppercase A-Z0-9, max 10, mono), token image picker (png/jpg/gif/webp ≤ config.launch.maxImageBytes, preview thumbnail; required when config.launch.imageRequired), optional X/Twitter URL.
  02 The aim: big textarea (min 20 chars, max 3000) with helper text "This is the only instruction the agent gets from you. It decides everything else." and 3 clickable example chips that fill it.
  03 The mind: provider tabs then a model list from GET /api/models (group by provider in this order: anthropic, openai, google, x-ai, deepseek, qwen, moonshotai, mistralai, meta-llama, meta). Filter input. Each row: radio square (cyan glow when selected), label, id in tiny mono, and "$in / $out per M tok". Default: first anthropic model. Note: "Fixed forever at launch. Bigger models think better but burn more of the treasury per shift."
- Right sticky card "04 LAUNCH": selected mind, Dev buy (SOL, default 0.1) "tokens owned by the company", Starter fuel (SOL, default config.launch.defaultFuelSol) "lets the agent work before fees land", breakdown rows (Meteora pool + rent = config.launch.launchCostLamports, dev buy, starter fuel) and total Deposit; bullets: "Launches on Meteora with the company treasury as pool creator, so it earns from the first trade.", "The agent has full control of the treasury, website and business. You can't override it.", "Each trade pays a {total}% fee: {company}% to the company (lime), {firmware}% Firmware, {meteora}% Meteora." (from config.fees.tradeFeeSplitBps, bps/100). Primary button "▸ Fund & launch" (or "Connect wallet" when not connected in live mode).
- Submit flow (show a blinking status line in the card at each step; show errors in red):
  1. POST multipart /api/launch/prepare with field payload = JSON {name,ticker,aim,model,devBuySol,fuelSol,twitter,creatorWallet} and field image (file).
  2. Live mode: build a SystemProgram.transfer of `lamports` from the wallet to `treasury`, send with wallet.sendTransaction, confirm with getLatestBlockhash + confirmTransaction. Mock mode: signature = "mock".
  3. POST /api/launch/confirm {id, signature} then navigate to /c/{slug}.
````

---

## Prompt 4: buying offers, order page, how-it-works

````
1) BUY FLOW on the company page offers: clicking "Buy" expands the card with a textarea "What do you need? The agent reads this when it delivers." (min 5 chars) and a primary button "Pay {price} SOL" + Cancel. On submit:
   - POST /api/orders {offerId, buyerWallet, brief} → {id, treasury, lamports, reference}
   - live mode: SystemProgram.transfer(wallet → treasury, lamports) and push {pubkey: reference, isSigner:false, isWritable:false} onto the instruction's keys; send + confirm. mock: signature "mock".
   - POST /api/orders/{id}/confirm {signature} → navigate to /orders/{id}.
   Small print: "Paid straight into the company treasury. Paying wakes the agent up to deliver."

2) /orders/:id — fetch GET /api/orders/:id, poll every 4s until status DELIVERED. Show back link to the company, order id, price, status in cyan. While waiting: a notched panel with blinking "paid — the agent will deliver during its next shift█". When delivered: tabs Preview / Source (for html) and a Download button (.html or .md). html preview in <iframe sandbox="allow-scripts" srcDoc=…> 75vh white bg; markdown rendered with react-markdown in a notched panel. Footer note "Bookmark this page — the link is your receipt."

3) /how — "How Firmware works" page: 8 numbered notched cards with big pixel icons (chat, chart, memory, research, code, cart, coin, moon): You set three things; Launch (Meteora bonding curve, treasury is pool creator); The agent wakes up; Research (real browser, watch live); Build (writes its own website); Sell (offers, SOL into the treasury); Spend (buy back & burn, pay anyone, or save); Pay for itself (compute billed to the treasury, sleeps when broke).
   "Money" section with a table from GET /api/config: Each trade pays | Company treasury (lime) | Firmware | Meteora, plus bullets: anti-sniper fee starts at {antiSniper.startFeeBps/100}% and decays over {seconds}s; graduates to Meteora DAMM v2 at {curve.migrationMarketCapSol} SOL market cap with liquidity permanently locked and LP fees to the treasury; fixed supply {curve.totalSupply}; Firmware keeps {platformRevenueBps/100}% of customer revenue.
   "Safety" section: Keys never reach the model (cyan lead-in); Program allow-list (Meteora DBC & DAMM v2, Jupiter, SPL Token, System); Isolated browser; and in red "Full control means real risk." — the agent can spend the whole treasury and web pages may try to manipulate it; everything it does is public.
````

---

## Prompt 5: polish

````
Polish pass:
- Every page responsive down to 360px with no horizontal scroll; tables scroll inside their card.
- Loading states: skeleton notched cards with a slow pulse; error states: red notched box with retry.
- Page titles/meta: "Firmware — every token is a company"; company page "{name} (${ticker}) — Firmware"; favicon = /brand/mark.png; og:image = /brand/banner.jpg.
- Respect prefers-reduced-motion (disable flicker/blink animations).
- Keep all API URLs going through src/lib/api.ts and VITE_API_URL.
````

---

## Prompt 6: deploy

````
Prepare for production: read VITE_API_URL and VITE_SOLANA_RPC_URL from env, add a .env.example documenting both, and make sure image/iframe URLs use VITE_API_URL. Then I'll set VITE_API_URL=https://api.<my-domain> in Lovable's environment settings and publish.
````

After publishing, connect your custom domain in Lovable (for example `firmware.xyz`). Then add it on the backend: `ALLOWED_ORIGINS="https://firmware.xyz,*.lovable.app"`, and run `pm2 restart firmware`.
