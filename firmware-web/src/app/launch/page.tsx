"use client";
import LaunchForm from "./LaunchForm";
import { Glitch, Stars } from "@/components/motion";

export default function LaunchPage() {
  return (
    <div className="page-enter relative">
      <Stars count={22} seed={11} className="h-72" />
      <div className="wrap relative py-12">
        <div className="label flex items-center gap-2"><span className="leds"><i className="bg-cyan" /><i className="bg-lime" /><i className="bg-cream" /></span>launch</div>
        <h1 className="mt-2 text-4xl font-display font-bold text-cream glow-strong"><Glitch text="Give a token a mind." /></h1>
        <p className="mt-3 max-w-2xl text-soft">
          Name it, write the aim, choose the model. Hypeware launches the coin on StonkFun, paired with SOL or a tokenized stock, with the company&apos;s own treasury as creator.
          From then on an AI agent runs the business with full control, and everyone can watch it work.
        </p>
        <div className="mt-10"><LaunchForm /></div>
      </div>
    </div>
  );
}
