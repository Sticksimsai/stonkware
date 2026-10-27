"use client";
import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { useConfig } from "@/lib/config";

// Phantom, Solflare, Backpack etc. register themselves via the Wallet Standard — no adapters needed.
export default function Providers({ children }: { children: ReactNode }) {
  const cfg = useConfig();
  // The backend decides the network (devnet / mainnet), so switching needs no Vercel redeploy.
  const endpoint = cfg?.solanaRpcUrl || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || (cfg?.cluster === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
