// Check the agents' browser setup end to end. Never prints keys.
//   npm run browser:check
import "./_env";

(async () => {
  const { env } = await import("../src/lib/env");
  const has = (v: string) => (v ? "set" : "MISSING");
  console.log(`BROWSERBASE_API_KEY    ${has(env.browserbaseKey)}`);
  console.log(`BROWSERBASE_PROJECT_ID ${has(env.browserbaseProject)}`);
  console.log(`CHROMIUM_PATH          ${env.chromiumPath || "(not set)"}`);
  const { openBrowser, lastBrowserFallback } = await import("../src/lib/agent/browser");
  const t = Date.now();
  const b = await openBrowser();
  const { lastBrowserFallback: why } = await import("../src/lib/agent/browser");
  console.log(`\n→ agents will use: ${b.kind}${b.kind === "browserbase" ? " ✓ (live video in the live view)" : b.kind === "local" ? " (screenshots only)" : " (text only, no screenshots)"}`);
  if (why ?? lastBrowserFallback) console.log(`  fallback reason: ${why ?? lastBrowserFallback}`);
  try {
    const v = await b.open("https://example.com");
    const shot = await b.screenshot();
    console.log(`  opened ${v.url} → "${v.title}" in ${Date.now() - t}ms · screenshot ${shot ? `${shot.length} bytes ✓` : "none"} · live view ${b.liveUrl ? "✓" : "none"}`);
  } catch (e) { console.log(`  opening a page failed: ${(e as Error).message.slice(0, 300)}`); }
  await b.close();
  process.exit(0);
})().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
