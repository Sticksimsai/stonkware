// Higgsfield + Seedance 2.5 check, using the official SDK (@higgsfield/client/v2).
// Makes ONE billable generation (5s, 720p, 16:9) and prints the video URL.
//
//   npm run higgsfield:example
//
// Credentials: HF_CREDENTIALS="key-id:key-secret" in .env.local (or .env) on the server.
// They are read at runtime and never printed.
import "./_env";
import { higgsfield, config, HiggsfieldError, NotEnoughCreditsError, AuthenticationError, ValidationError, BadInputError, TimeoutError, type V2Response } from "@higgsfield/client/v2";

const MODEL = "bytedance/seedance-2.5/text-to-video";

(async () => {
  const creds = process.env.HF_CREDENTIALS ?? "";
  if (!creds) {
    console.error("✗ HF_CREDENTIALS is not set. Add HF_CREDENTIALS=\"key-id:key-secret\" to .env.local on this server (never commit it).");
    process.exit(1);
  }
  if (!/^[^:\s]+:[^:\s]+$/.test(creds)) {
    console.error("✗ HF_CREDENTIALS must look like key-id:key-secret (one colon, no spaces). Value not shown.");
    process.exit(1);
  }
  config({ credentials: creds, maxPollTime: 15 * 60_000, pollInterval: 3000 });

  console.log(`▸ Submitting ${MODEL} (5s · 720p · 16:9). This is a billable request…`);
  const started = Date.now();
  let res: V2Response;
  try {
    res = await higgsfield.subscribe(MODEL, {
      input: { prompt: "A cinematic scene at sunset", duration: 5, resolution: "720p", aspect_ratio: "16:9" },
      withPolling: true,
    });
  } catch (e) {
    const why =
      e instanceof AuthenticationError ? "invalid credentials (check the key id and secret)"
      : e instanceof NotEnoughCreditsError ? "HTTP 403: usually not enough credits on the Higgsfield account (or a firewall/proxy blocked api.higgsfield.ai)"
      : e instanceof ValidationError || e instanceof BadInputError ? `the request was rejected: ${e.message}`
      : e instanceof TimeoutError ? "it didn't finish in time (it may have been canceled); no video was confirmed"
      : e instanceof HiggsfieldError ? e.message
      : (e as Error).message;
    console.error(`✗ Generation did not succeed: ${why}`);
    process.exit(1);
  }

  const secs = Math.round((Date.now() - started) / 1000);
  if (res.status === "completed" && res.video?.url) {
    console.log(`✓ Completed in ${secs}s (request ${res.request_id})`);
    console.log(`  video: ${res.video.url}`);
    process.exit(0);
  }
  const reason =
    res.status === "nsfw" ? "blocked by Higgsfield's content moderation (not charged)"
    : res.status === "failed" ? "the generation failed on Higgsfield's side (not charged)"
    : (res.status as string) === "canceled" ? "the request was canceled"
    : res.status === "completed" ? "completed but no video URL was returned"
    : `ended with status "${res.status}"`;
  console.error(`✗ Generation did not succeed: ${reason} (request ${res.request_id})`);
  process.exit(1);
})();
