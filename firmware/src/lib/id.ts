import { randomBytes } from "crypto";
/** Short, URL-safe, sortable-enough id. */
export function createId(): string {
  return Date.now().toString(36) + randomBytes(8).toString("hex");
}
