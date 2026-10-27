"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { MOCK_WALLET, postJSON, sendSol } from "@/lib/client/tx";

type Offer = { id: string; title: string; description: string; priceLamports: number };

export default function BuyOffer({ o, mode }: { o: Offer; mode: string }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const wallet = useWallet();
  const { connection } = useConnection();
  const modal = useWalletModal();
  const router = useRouter();
  const mock = mode !== "live";
  const price = (o.priceLamports / 1e9).toLocaleString();

  async function buy() {
    setErr("");
    try {
      const buyer = wallet.publicKey?.toBase58() ?? (mock ? MOCK_WALLET : null);
      if (!buyer) return modal.setVisible(true);
      setBusy("Creating order…");
      const r = await postJSON<{ id: string; treasury: string; lamports: number; reference: string }>("/api/orders", { offerId: o.id, buyerWallet: buyer, brief });
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

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-pixel text-[13px] uppercase text-cream">{o.title}</div>
          <p className="mt-1 text-sm text-soft">{o.description}</p>
        </div>
        <div className="num shrink-0 text-cream">{price} SOL</div>
      </div>
      {!open ? (
        <button className="btn-ghost mt-3 w-full !py-2" onClick={() => setOpen(true)}>Buy</button>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea className="input min-h-[100px]" placeholder="What do you need? The agent reads this when it delivers." value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000} />
          <div className="flex gap-2">
            <button className="btn-acid flex-1" disabled={!!busy || brief.trim().length < 5} onClick={buy}>{busy || `Pay ${price} SOL`}</button>
            <button className="btn-ghost" onClick={() => setOpen(false)} disabled={!!busy}>Cancel</button>
          </div>
          {err && <p className="text-sm text-red">{err}</p>}
          <p className="text-xs text-mute">Paid straight into the company treasury. Paying wakes the agent up to deliver.</p>
        </div>
      )}
    </div>
  );
}
