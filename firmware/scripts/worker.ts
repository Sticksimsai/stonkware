// The heartbeat process. Run alongside `next start` on a persistent server:
//   npm run worker
// Every 30s: claim due creator fees, settle compute, start shifts for agents that are due.
import { readFileSync, existsSync } from "fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

(async () => {
  const { claimDue, startDueShifts } = await import("../src/lib/tick");
  const { pollMedia } = await import("../src/lib/media");
  const { pollMerch } = await import("../src/lib/merch");
  const { pollDev } = await import("../src/lib/selfdev");
  const { settleVanity } = await import("../src/lib/vanity");
  const every = Number(process.env.WORKER_INTERVAL_SEC || 30) * 1000;
  console.log(`[worker] up — every ${every / 1000}s`);
  const beat = async () => {
    try {
      const claimed = await claimDue();
      const started = await startDueShifts();
      await pollMedia();
      await pollMerch();
      await pollDev();
      await settleVanity();
      if (claimed || started.length) console.log(`[worker] claimed=${claimed} started=${started.join(",") || "-"}`);
    } catch (e) {
      console.error("[worker]", (e as Error).message);
    }
  };
  await beat();
  setInterval(beat, every);
})();
