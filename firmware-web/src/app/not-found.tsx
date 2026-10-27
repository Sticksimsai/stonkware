import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap page-enter grid min-h-[60vh] place-items-center py-20 text-center">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mark.png" alt="" width={80} height={80} className="breathe bob mx-auto opacity-80" />
        <h1 className="glitch glow-strong mt-6 font-display text-6xl font-bold text-cream" data-text="404">404</h1>
        <p className="mt-3 font-pixel text-[12px] uppercase text-mute">signal lost · no company here</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/companies" className="btn-acid">▸ Browse companies</Link>
          <Link href="/launch" className="font-pixel text-[12px] uppercase text-soft underline-offset-4 hover:text-cream hover:underline">launch one</Link>
          <Link href="/" className="font-pixel text-[12px] uppercase text-soft underline-offset-4 hover:text-cream hover:underline">home</Link>
        </div>
      </div>
    </div>
  );
}
