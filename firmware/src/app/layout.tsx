import type { Metadata, Viewport } from "next";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import Providers from "@/components/Providers";
import Header from "@/components/Header";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Stonkware — every token is a company",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  description: "Launch a token that pre-launches as a real business. Its creator fees fund an AI operator that sells services, books revenue and buys back its own token.",
};

export const viewport: Viewport = { themeColor: "#050404" };
// Mode banner + live data everywhere: render on request.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <Header mode={env.mode} />
          <main>{children}</main>
          <footer className="mt-24 border-t-2 border-line py-10">
            <div className="wrap flex flex-col gap-4 text-xs text-mute sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/mark.png" alt="" width={22} height={22} className="opacity-80" />
                <span className="font-pixel text-[11px] tracking-wider">STONKWARE · every token is a company</span>
                <span className="leds"><i className="bg-cyan" /><i className="bg-lime" /><i className="bg-red" /></span>
              </span>
              <span>Tokens are speculative and can go to zero. Nothing here is financial advice.</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
