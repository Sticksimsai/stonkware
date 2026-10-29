// Loaded first by hl.test.ts: env.ts reads these when it is imported.
import { randomBytes } from "crypto";
process.env.VAULT_KEY ||= randomBytes(32).toString("hex");
process.env.FIRMWARE_MODE = "mock";
