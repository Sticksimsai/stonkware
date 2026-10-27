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
import BootScreen from "@/components/BootScreen";
import { ConfigProvider } from "@/lib/config";
import { X_HANDLE, X_URL } from "@/lib/social";

export const metadata: Metadata = {
  title: "Stonkware — every token is a company",
  description: "Launch a token that becomes a company. An autonomous AI agent runs it — researches, builds its own website, sells, and spends — funded by its trading fees. Watch it work live.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"),
  openGraph: { images: ["/opengraph-image.jpg"] },
  twitter: { card: "summary_large_image", site: X_HANDLE, creator: X_HANDLE },
};
export const viewport: Viewport = { themeColor: "#03050c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <ConfigProvider>
          <Providers>
            <BootScreen />
            <div className="sweep" aria-hidden />
            <Header />
            <main>{children}</main>
            <footer className="mt-24 border-t-2 border-line py-10">
              <div className="wrap flex flex-col gap-4 text-xs text-mute sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/mark.png" alt="" width={22} height={22} className="opacity-80" />
                  <span className="font-pixel text-[11px] tracking-wider">STONKWARE · every token is a company</span>
                  <span className="leds"><i className="bg-cyan" /><i className="bg-lime" /><i className="bg-cream" /></span>
                </span>
                <span className="flex flex-col gap-2 sm:items-end">
                  <a href={X_URL} target="_blank" rel="noreferrer" className="font-pixel text-[11px] uppercase tracking-wider text-soft hover:text-cream">Follow {X_HANDLE} on X ↗</a>
                  <span>Tokens are speculative and can go to zero. Nothing here is financial advice.</span>
                </span>
              </div>
            </footer>
          </Providers>
        </ConfigProvider>
      </body>
    </html>
  );
}
