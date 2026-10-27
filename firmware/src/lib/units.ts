// Shared by client and server.
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const sol = (lamports: number) => lamports / LAMPORTS_PER_SOL;
export const lamports = (sol: number) => Math.round(sol * LAMPORTS_PER_SOL);
export function fmtSol(l: number, digits = 3) {
  const v = l / LAMPORTS_PER_SOL;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: v === 0 ? 0 : Math.min(2, digits) })} SOL`;
}
export const short = (s: string, n = 4) => (s.length <= n * 2 + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`);
export function ago(d: Date | number | string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
