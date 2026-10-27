"use client";
// Company-page surfaces for what the agent built beyond its website: bots, downloadable apps,
// and the creator-only panel to connect bot accounts the agent asked for.
import { useState } from "react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { API, postJSON } from "@/lib/api";
import type { BotInfo, ConnectRequest, PackageInfo } from "@/lib/types";
import PixelIcon from "./PixelIcon";

const NAME = { telegram: "Telegram", discord: "Discord" } as const;

export function BotsSection({ bots }: { bots: BotInfo[] }) {
  const shown = bots.filter((b) => b.connected || b.live);
  if (!shown.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {shown.map((b) => (
        <div key={b.platform} className="card lift p-4">
          <div className="flex items-center gap-2">
            <PixelIcon name="chat" size={18} />
            <span className="font-pixel text-[12px] uppercase text-cream">{NAME[b.platform]} bot</span>
            <span className={`ml-auto font-pixel text-[9px] uppercase ${b.live ? "text-cyan" : "text-mute"}`}>{b.live ? <><span className="flicker">●</span> live</> : "setting up"}</span>
          </div>
          <div className="mt-2 font-mono text-[13px] text-cream">{b.account}</div>
          {b.commands.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{b.commands.map((c) => <span key={c} className="border border-line px-1.5 py-0.5 font-mono text-[10px] text-soft">/{c}</span>)}</div>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-mute">{b.handled.toLocaleString()} messages handled</span>
            {b.link && <a href={b.link} target="_blank" rel="noreferrer" className="btn-acid whitespace-nowrap !px-3 !py-1.5 !text-[10px]">{b.platform === "telegram" ? "Open in Telegram" : "Add to server"} ↗</a>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PackagesSection({ packages }: { packages: PackageInfo[] }) {
  if (!packages.length) return null;
  return (
    <div className="grid gap-3">
      {packages.map((p) => (
        <div key={p.id} className="card lift flex items-start gap-3 p-4">
          <PixelIcon name={p.kind === "extension" ? "browser" : p.kind === "app" ? "code" : "doc"} size={22} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-pixel text-[12px] uppercase text-cream">{p.title || p.name}</span>
              <span className="border border-line px-1.5 py-0.5 font-pixel text-[9px] uppercase text-soft">{p.kind} · v{p.version}</span>
            </div>
            <p className="mt-1 line-clamp-3 text-sm text-soft">{p.description}</p>
            <div className="mt-1 font-mono text-[11px] text-mute">{p.downloads.toLocaleString()} downloads</div>
          </div>
          {p.url ? (
            <a href={p.url} className="btn-acid shrink-0 !px-3 !py-1.5 !text-[10px]">⬇ Free</a>
          ) : (
            <a href="#offers" className="btn-ghost shrink-0 !px-3 !py-1.5 !text-[10px]">Buy ↓</a>
          )}
        </div>
      ))}
    </div>
  );
}

const STEPS = {
  telegram: [
    "Open @BotFather in Telegram and send /newbot.",
    "Pick a name and a username ending in “bot”.",
    "Copy the token BotFather gives you and paste it below.",
  ],
  discord: [
    "Go to discord.com/developers/applications → New Application.",
    "From General Information, copy the Application ID and Public Key.",
    "Bot tab → Reset Token → copy the bot token.",
    "After connecting, paste the Interactions Endpoint URL we show you into General Information.",
  ],
};

/** Creator-only: connect the bot accounts the agent asked for. Signed with the creator wallet. */
export function ConnectPanel({ slug, ticker, companyId, creatorWallet, requests, bots, mock }: { slug: string; ticker: string; companyId: string; creatorWallet: string; requests: ConnectRequest[]; bots: BotInfo[]; mock: boolean }) {
  const wallet = useWallet();
  const modal = useWalletModal();
  // the form only exists for the launch wallet; everyone else at most sees the agent's request
  const isCreator = !!wallet.publicKey && wallet.publicKey.toBase58() === creatorWallet;
  void mock;
  const [platform, setPlatform] = useState<"telegram" | "discord">(requests[0]?.platform ?? "telegram");
  const [f, setF] = useState({ token: "", appId: "", publicKey: "", botToken: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState<Record<string, unknown> | null>(null);
  const connected = bots.find((b) => b.platform === platform)?.connected;

  if (!requests.length && !isCreator) return null;

  async function submit(action: "connect" | "disconnect") {
    setMsg(null);
    if (!wallet.publicKey) return modal.setVisible(true);
    if (!wallet.signMessage) return setMsg({ ok: false, text: "Your wallet can't sign messages. Try Phantom or Solflare." });
    setBusy(true);
    try {
      const ts = Date.now();
      const text = `Stonkware: ${action} ${platform} for $${ticker}\ntime: ${ts}`;
      const signature = bs58.encode(await wallet.signMessage!(new TextEncoder().encode(text)));
      const secrets = platform === "telegram" ? { token: f.token } : { appId: f.appId, publicKey: f.publicKey, botToken: f.botToken };
      const r = await postJSON<{ ok: boolean; meta?: Record<string, unknown> }>(`/api/companies/${slug}/connect`, { platform, action, wallet: wallet.publicKey?.toBase58(), signature, ts, secrets: action === "connect" ? secrets : {} });
      setF({ token: "", appId: "", publicKey: "", botToken: "" });
      setDone(r.meta ?? null);
      setMsg({ ok: true, text: action === "connect" ? "Connected. The agent has been woken up to run it." : "Disconnected." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-cyan/40 p-5">
      <div className="flex items-center gap-2">
        <PixelIcon name="flow" size={16} />
        <span className="font-pixel text-[12px] uppercase text-cyan">{isCreator ? "Creator · connect accounts" : "Waiting for the creator"}</span>
      </div>
      {requests.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {requests.map((r) => (
            <li key={r.platform} className="text-sm text-soft"><span className="text-cream">The agent wants a {NAME[r.platform]} bot:</span> {r.why}</li>
          ))}
        </ul>
      )}
      {!isCreator ? (
        <p className="mt-3 text-xs text-mute">Waiting for the creator to connect it. Only the wallet that launched this company can.</p>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex gap-1.5">
            {(["telegram", "discord"] as const).map((p) => (
              <button key={p} onClick={() => { setPlatform(p); setMsg(null); setDone(null); }} className={`notch border-2 px-2.5 py-1 font-pixel text-[10px] uppercase ${platform === p ? "border-cream text-cream" : "border-line text-mute"}`}>
                {NAME[p]}{bots.find((b) => b.platform === p)?.connected ? " ✓" : ""}
              </button>
            ))}
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-soft">{STEPS[platform].map((s) => <li key={s}>{s}</li>)}</ol>
          {platform === "telegram" ? (
            <input className="input" type="password" placeholder="123456789:AA…  (bot token)" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="off" />
          ) : (
            <div className="grid gap-2">
              <input className="input" placeholder="Application ID" value={f.appId} onChange={(e) => setF({ ...f, appId: e.target.value })} autoComplete="off" />
              <input className="input" placeholder="Public Key" value={f.publicKey} onChange={(e) => setF({ ...f, publicKey: e.target.value })} autoComplete="off" />
              <input className="input" type="password" placeholder="Bot token" value={f.botToken} onChange={(e) => setF({ ...f, botToken: e.target.value })} autoComplete="off" />
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-acid flex-1" disabled={busy || (platform === "telegram" ? f.token.length < 20 : !(f.appId && f.publicKey && f.botToken))} onClick={() => submit("connect")}>
              {busy ? <span className="cursor">Signing…</span> : connected ? "Replace & sign" : "Connect & sign"}
            </button>
            {connected && <button className="btn-ghost" disabled={busy} onClick={() => submit("disconnect")}>Disconnect</button>}
          </div>
          {msg && <p className={`text-sm ${msg.ok ? "text-lime" : "text-red"}`}>{msg.text}</p>}
          {done && platform === "discord" && (
            <div className="space-y-2 border-2 border-line bg-ink p-3 text-xs text-soft">
              <div>Interactions Endpoint URL (paste in General Information):</div>
              <code className="block break-all text-cream">{`${API}/api/hooks/discord/${companyId}`}</code>
              {typeof done.invite === "string" && <a href={done.invite} target="_blank" rel="noreferrer" className="link text-cream">Add the bot to your server ↗</a>}
            </div>
          )}
          <p className="text-[11px] text-mute">You sign a message (no transaction, no fee) to prove you&apos;re the creator. Tokens are encrypted on Stonkware&apos;s server and never shown to the AI.</p>
        </div>
      )}
    </div>
  );
}
