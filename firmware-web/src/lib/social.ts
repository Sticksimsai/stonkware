// X account. Set NEXT_PUBLIC_X_HANDLE (e.g. "Hypeware") in Vercel to point the nav/footer at it.
const handle = (process.env.NEXT_PUBLIC_X_HANDLE || "TryFirmware").replace(/^@/, "");
export const X_URL = `https://x.com/${handle}`;
export const X_HANDLE = `@${handle}`;
