"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { postJSON } from "@/lib/api";
import { MOCK_WALLET, sendSol } from "@/lib/tx";
import type { Offer } from "@/lib/types";
import PixelIcon from "@/components/PixelIcon";

type Ship = { name: string; address1: string; address2: string; city: string; state_code: string; country_code: string; zip: string; email: string };
const EMPTY: Ship = { name: "", address1: "", address2: "", city: "", state_code: "", country_code: "US", zip: "", email: "" };

export default function BuyOffer({ o, mock }: { o: Offer; mock: boolean }) {
  const kind = o.kind ?? "service";
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [variant, setVariant] = useState<number | null>(o.merch?.variants[0]?.id ?? null);
  const [ship, setShip] = useState<Ship>(EMPTY);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const wallet = useWallet();
  const { connection } = useConnection();
  const modal = useWalletModal();
  const router = useRouter();
  const price = (o.priceLamports / 1e9).toLocaleString();

  const shipOk = ship.name.trim().length > 1 && ship.address1.trim().length > 2 && ship.city.trim() && /^[A-Za-z]{2}$/.test(ship.country_code) && ship.zip.trim().length > 1;
  const ready = kind === "merch" ? !!variant && shipOk : kind === "download" ? true : brief.trim().length >= 5;

  async function buy() {
    setErr("");
    try {
      const buyer = wallet.publicKey?.toBase58() ?? (mock ? MOCK_WALLET : null);
      if (!buyer) return modal.setVisible(true);
      setBusy("Creating order…");
      const r = await postJSON<{ id: string; treasury: string; lamports: number; reference: string }>("/api/orders", {
        offerId: o.id, buyerWallet: buyer, brief,
        ...(kind === "merch" ? { variantId: variant, shipping: { ...ship, email: ship.email || undefined, address2: ship.address2 || undefined, state_code: ship.state_code || undefined } } : {}),
      });
      setBusy(mock ? "Simulating payment…" : "Approve the payment in your wallet…");
      const sig = mock ? "mock" : await sendSol(connection, wallet, r.treasury, r.lamports, r.reference);
      setBusy("Verifying payment…");
      await postJSON(`/api/orders/${r.id}/confirm`, { signature: sig });
      router.push(`/orders/${r.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy("");
    }
  }

  const field = (k: keyof Ship, ph: string, cls = "") => (
    <input className={`input !py-2 ${cls}`} placeholder={ph} value={ship[k]} onChange={(e) => setShip({ ...ship, [k]: k === "country_code" ? e.target.value.toUpperCase().slice(0, 2) : e.target.value })} autoComplete="off" />
  );

  return (
    <div className="card lift p-4">
      <div className="flex items-start gap-4">
        {kind === "merch" && o.merch?.designUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={o.merch.designUrl} alt="" className="h-16 w-16 shrink-0 border-2 border-line bg-ink object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-pixel text-[13px] uppercase text-cream">{o.title}</span>
            {kind !== "service" && (
              <span className="flex items-center gap-1 border border-line px-1.5 py-0.5 font-pixel text-[9px] uppercase text-cyan">
                <PixelIcon name={kind === "merch" ? "cart" : "doc"} size={10} glow={false} />{kind === "merch" ? "ships worldwide" : "instant download"}
              </span>
            )}
          </div>
          {kind === "merch" && o.merch && <div className="mt-0.5 font-mono text-[11px] text-mute">{o.merch.productTitle}</div>}
          <p className="mt-1 text-sm text-soft">{o.description}</p>
        </div>
        <div className="num glow shrink-0 text-lime">{price} SOL</div>
      </div>
      {!open ? (
        <button className="btn-ghost mt-3 w-full !py-2" onClick={() => setOpen(true)}>{kind === "download" ? "Buy & download" : "Buy"}</button>
      ) : (
        <div className="slide-in mt-3 space-y-2">
          {kind === "service" && (
            <textarea className="input min-h-[100px]" placeholder="What do you need? The agent reads this when it delivers." value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000} />
          )}
          {kind === "merch" && o.merch && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {o.merch.variants.map((v) => (
                  <button key={v.id} type="button" onClick={() => setVariant(v.id)} className={`notch border-2 px-2.5 py-1 font-mono text-[11px] ${variant === v.id ? "border-cream text-cream" : "border-line text-mute hover:text-cream"}`}>{v.label}</button>
                ))}
              </div>
              <div className="label pt-1">ship to</div>
              <div className="grid grid-cols-2 gap-2">
                {field("name", "Full name", "col-span-2")}
                {field("address1", "Address", "col-span-2")}
                {field("address2", "Apt, suite (optional)", "col-span-2")}
                {field("city", "City")}
                {field("state_code", "State / region")}
                {field("zip", "ZIP / postcode")}
                {field("country_code", "Country (US, GB…)")}
                {field("email", "Email for tracking (optional)", "col-span-2")}
              </div>
              <p className="text-[11px] text-mute">Your address is encrypted and only sent to Printful to print and ship your order. The AI agent never sees it.</p>
            </>
          )}
          {kind === "download" && <p className="text-xs text-soft">You get the download link the moment the payment confirms.</p>}
          <div className="flex gap-2">
            <button className="btn-acid flex-1" disabled={!!busy || !ready} onClick={buy}>{busy ? <span className="cursor">{busy}</span> : `Pay ${price} SOL`}</button>
            <button className="btn-ghost" onClick={() => setOpen(false)} disabled={!!busy}>Cancel</button>
          </div>
          {err && <p className="text-sm text-red">{err}</p>}
          <p className="text-xs text-mute">Paid straight into the company treasury.{kind === "service" ? " Paying wakes the agent up to deliver." : ""}</p>
        </div>
      )}
    </div>
  );
}
