import { claimDue, startDueShifts } from "./lib/tick";
import { pollMedia } from "./lib/media";
import { pollMerch } from "./lib/merch";
import { pollDev } from "./lib/selfdev";
import { settleVanity } from "./lib/vanity";
import { payPendingDevBuys, recoverLaunches, seedAttempts } from "./lib/recovery";
import { hlUpkeep } from "./lib/hl/accounts";
import { hlBridgeUpkeep } from "./lib/hl/bridge";
import { trackFlagshipFees } from "./lib/flagship";

if (process.env.RUN_SCHEDULER !== "0" && process.env.NEXT_PHASE !== "phase-production-build") {
  const every = Number(process.env.WORKER_INTERVAL_SEC || 30) * 1000;
  const beat = async () => {
    try { await claimDue(); await startDueShifts(); await pollMedia(); await pollMerch(); await pollDev(); await settleVanity(); await recoverLaunches(); await payPendingDevBuys(); await trackFlagshipFees(); await hlUpkeep(); await hlBridgeUpkeep(); } catch (e) { console.error("[scheduler]", (e as Error).message); }
  };
  void seedAttempts().catch(() => {});
  setTimeout(beat, 5000);
  setInterval(beat, every);
  console.log(`[scheduler] running every ${every / 1000}s`);
}
