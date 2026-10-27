"use client";
import dynamic from "next/dynamic";
export const WalletButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false, loading: () => <div className="h-9 w-32 bg-line" /> },
);
