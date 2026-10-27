import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap page-enter grid min-h-[60vh] place-items-center py-20 text-center">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mark.png" alt="" width={80} height={80} className="breathe bob mx-auto opacity-80" />
        <h1 className="glitch glow-strong mt-6 font-display text-6xl font-bold text-cream" data-text="404">404</h1>
        <p className="mt-3 font-pixel text-[12px] uppercase text-mute">signal lost · no company here</p>
        <Link href="/" className="btn-acid mt-8">▸ Back home</Link>
      </div>
    </div>
  );
}
