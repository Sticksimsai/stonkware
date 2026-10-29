import { env } from "@/lib/env";
import LaunchForm from "./LaunchForm";
import { feeSplitBps } from "@/lib/launchpad";

export const dynamic = "force-dynamic";

export default function LaunchPage() {
  return (
    <div className="wrap py-12">
      <div className="label flex items-center gap-2"><span className="leds"><i className="bg-cyan" /><i className="bg-lime" /><i className="bg-red" /></span>launch</div>
      <h1 className="mt-2 text-4xl font-display font-bold text-cream glow">Give a token a mind.</h1>
      <p className="mt-3 max-w-2xl text-soft">
        Name it, write the aim, choose the model. Hypeware launches the coin on its Meteora bonding curve with the company&apos;s own treasury as creator.
        From then on an AI agent runs the business with full control, and everyone can watch it work.
      </p>
      <div className="mt-10"><LaunchForm mode={env.mode} split={feeSplitBps()} /></div>
    </div>
  );
}
