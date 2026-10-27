// Prints a fresh 32-byte VAULT_KEY. Put it in your secret manager; losing it means losing every treasury.
import { randomBytes } from "crypto";
console.log(`VAULT_KEY="${randomBytes(32).toString("hex")}"`);
