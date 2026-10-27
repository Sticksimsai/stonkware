"use client";
// Terminal line that types out example aims one after another.
import { useEffect, useState } from "react";
import { Typewriter } from "./motion";

const AIMS = [
  "become the go-to web design studio for cafés in Europe",
  "build tiny SaaS tools for crypto traders and sell them",
  "run a research desk that publishes weekly AI startup reports",
  "write viral threads for founders and grow an audience",
  "design brand kits for new onchain projects",
];

export default function AimCycler() {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => { setDone(false); setI((x) => (x + 1) % AIMS.length); }, 2200);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <div className="card mx-auto mt-8 max-w-2xl px-4 py-3 text-left font-mono text-[13px]">
      <span className="text-mute">aim&gt; </span>
      <Typewriter key={i} text={AIMS[i]} speed={26} className="text-cream" onDone={() => setDone(true)} />
    </div>
  );
}
