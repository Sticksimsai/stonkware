"use client";
// Live view of an agent at work: its browser (Browserbase live stream or latest screenshot) + a step-by-step log.
import { useEffect, useRef, useState } from "react";
import PixelIcon, { TOOL_ICON } from "./PixelIcon";
import { API, shotUrl } from "@/lib/api";
import { MediaThumb } from "./MediaGallery";

type Step = { id: string; seq: number; kind: string; tool: string | null; content: string; url: string | null; createdAt: string };
type Run = { id: string; status: string; liveUrl: string | null; browser: string; steps: number; costLamports: number; summary: string | null; startedAt: string; endedAt: string | null };


function since(d: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

function until(d: string) {
  const s = Math.floor((new Date(d).getTime() - Date.now()) / 1000);
  if (s <= 30) return "next shift starting…";
  return s < 3600 ? `next shift in ${Math.ceil(s / 60)}m` : `next shift in ${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}

function StepRow({ s, onShot }: { s: Step; onShot: (id: string) => void }) {
  return <div className="slide-in"><StepBody s={s} onShot={onShot} /></div>;
}

function StepBody({ s, onShot }: { s: Step; onShot: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (s.kind === "SHOT")
    return (
      <button onClick={() => onShot(s.id)} className="ml-5 block py-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shotUrl(s.id)} alt="" className="h-16 border-2 border-line opacity-80 hover:border-cream/50 hover:opacity-100" loading="lazy" />
      </button>
    );
  if (s.kind === "MEDIA" && s.url)
    return (
      <div className="slide-in my-1.5 ml-5 flex items-start gap-2">
        <MediaThumb url={s.url} className="h-24 max-w-[180px] border-2 border-cyan/50 object-cover" />
        <span className="line-clamp-3 font-mono text-[11px] text-soft"><span className="text-cyan">rendered</span> {s.content}</span>
      </div>
    );
  if (s.kind === "THINK") return <div className="my-1 whitespace-pre-wrap border-l-2 border-cyan py-1.5 pl-3 text-[13px] leading-relaxed text-cream-dim">{s.content}</div>;
  if (s.kind === "TOOL")
    return (
      <div className="flex items-center gap-2 py-1 font-mono text-[12px]">
        <PixelIcon name={TOOL_ICON[s.tool ?? ""] ?? "bolt"} size={14} />
        <span className="glow text-cream">{s.tool}</span>
        <span className="truncate text-soft">{s.content === "{}" ? "" : s.content}</span>
      </div>
    );
  const err = s.kind === "ERROR";
  const long = s.content.length > 220;
  return (
    <div className={`ml-[22px] cursor-default whitespace-pre-wrap py-0.5 font-mono text-[11px] leading-relaxed ${err ? "text-red" : "text-mute"}`} onClick={() => long && setOpen(!open)}>
      {open || !long ? s.content : s.content.slice(0, 220) + "…"}
      {long && <span className="ml-1 text-mute">[{open ? "less" : "more"}]</span>}
    </div>
  );
}

export default function LiveView({ slug, compact = false }: { slug: string; compact?: boolean }) {
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [sleeping, setSleeping] = useState<string | null>(null);
  const [nextShift, setNextShift] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // follow the newest step like a terminal, unless the viewer scrolled up to read
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const state = useRef({ runId: "", seq: 0 });

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const st = state.current;
        const r = await fetch(`${API}/api/companies/${slug}/live?after=${st.seq}`, { cache: "no-store" });
        const j = (await r.json()) as { run: Run | null; steps: Step[]; sleepingUntil: string | null; nextShiftAt?: string | null };
        if (stop) return;
        setSleeping(j.sleepingUntil);
        setNextShift(j.nextShiftAt ?? null);
        if (!j.run) return;
        if (j.run.id !== st.runId) {
          // new run → reload from the start
          const full = await (await fetch(`${API}/api/companies/${slug}/live?after=0&run=${j.run.id}`, { cache: "no-store" })).json();
          st.runId = j.run.id;
          st.seq = full.steps.at(-1)?.seq ?? 0;
          setRun(full.run);
          setSteps(full.steps);
          setPinned(null);
        } else {
          setRun(j.run);
          if (j.steps.length) {
            st.seq = j.steps.at(-1)!.seq;
            setSteps((prev) => [...prev, ...j.steps]);
          }
        }
      } catch { /* retry next tick */ }
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [slug]);

  const toLatest = (smooth = false) => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    followRef.current = true;
    setFollow(true);
  };
  // jump to the newest step whenever steps arrive (and on first load / new shift)
  useEffect(() => {
    if (followRef.current) requestAnimationFrame(() => toLatest());
  }, [steps.length, run?.id, run?.status]);
  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottom !== followRef.current) { followRef.current = atBottom; setFollow(atBottom); }
  };

  const running = run?.status === "RUNNING";
  const shots = steps.filter((s) => s.kind === "SHOT" || (s.kind === "MEDIA" && !!s.url));
  const shot = pinned ? steps.find((s) => s.id === pinned) : shots.at(-1);
  const isSleeping = !running && sleeping && new Date(sleeping).getTime() > Date.now();

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b-2 border-line px-4 py-2.5 font-mono text-[11px]">
        {running ? <span className="glow font-pixel text-[11px] text-cyan"><span className="flicker">●</span> WORKING</span> : isSleeping ? <span className="flex items-center gap-1.5 font-pixel text-[11px] text-mute"><PixelIcon name="moon" size={12} glow={false} /> SLEEPING</span> : <span className="font-pixel text-[11px] text-mute">● IDLE</span>}
        {run && <span className="text-mute">{running ? `started ${since(run.startedAt)} ago` : `last shift ${since(run.endedAt ?? run.startedAt)} ago`}</span>}
        {!running && !isSleeping && nextShift && <span className="text-cyan">{until(nextShift)}</span>}
        {run && <span className="text-mute">{steps.filter((s) => s.kind === "TOOL").length} actions</span>}
        {run && run.browser !== "none" && <span className="text-mute">browser · {run.browser}</span>}
        {run && run.costLamports > 0 && <span className="ml-auto text-mute">cost {(run.costLamports / 1e9).toFixed(5)} SOL</span>}
      </div>

      <div className={`grid ${compact ? "" : "lg:grid-cols-[1.35fr_1fr]"}`}>
        {/* screen */}
        <div className="min-w-0 border-b-2 border-line bg-black lg:border-b-0 lg:border-r-2">
          <div className="flex items-center gap-2 border-b-2 border-line bg-raise px-3 py-1.5">
            <span className="leds"><i className="bg-cream" /><i className="bg-lime" /><i className="bg-cyan" /></span>
            <span className="truncate font-mono text-[11px] text-mute">{shot?.kind === "MEDIA" ? "studio · new render" : shot?.url ?? (running ? "…" : "about:blank")}</span>
            {pinned && <button className="ml-auto font-mono text-[10px] text-cream" onClick={() => setPinned(null)}>latest ↻</button>}
          </div>
          <div className="relative aspect-[16/10] w-full">
            {running && run?.liveUrl && !pinned ? (
              <iframe src={run.liveUrl} title="live browser" sandbox="allow-same-origin allow-scripts" className="pointer-events-none absolute inset-0 h-full w-full" />
            ) : shot ? (
              shot.kind === "MEDIA" ? (
                <div key={shot.id} className="crt-on absolute inset-0 bg-black"><MediaThumb url={shot.url!} className="h-full w-full object-contain" /></div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={shot.id} src={shotUrl(shot.id)} alt="agent browser" className="crt-on absolute inset-0 h-full w-full object-cover object-top" />
              )
            ) : (
              <div className="absolute inset-0 grid place-items-center">
                <div className="flex flex-col items-center gap-3 font-pixel text-[11px] text-mute">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/mark.png" alt="" width={56} height={56} className="opacity-60" />
                  <span className={running ? "cursor" : ""}>
                    {run?.browser === "fetch" ? "text-only browsing this shift (no screen)" : running ? "waiting for the browser" : "no browser activity yet"}
                  </span>
                  {run?.browser === "fetch" && <span className="max-w-[260px] text-center font-mono text-[10px] normal-case text-mute">The agent is still reading the web; pages appear in the log on the right.</span>}
                </div>
              </div>
            )}
            {running && <span className="absolute left-2 top-2 bg-ink/80 px-1.5 py-0.5 font-pixel text-[9px] text-red"><span className="flicker">●</span> LIVE</span>}
          </div>
          {shots.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto border-t-2 border-line p-2">
              {shots.slice(-12).map((s) => (
                <button key={s.id} onClick={() => setPinned(s.id)} className={`shrink-0 border-2 ${shot?.id === s.id ? "border-cream" : "border-line"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {s.kind === "MEDIA" ? <MediaThumb url={s.url!} autoPlay={false} className="h-10 w-16 object-cover" /> : <img src={shotUrl(s.id)} alt="" className="h-10 w-16 object-cover object-top" loading="lazy" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* log */}
        <div className="relative min-w-0">
        <div ref={logRef} onScroll={onScroll} className={`min-w-0 overflow-y-auto px-4 py-3 ${compact ? "max-h-64" : "max-h-[560px]"}`}>
          {!run && <div className="py-10 text-center font-pixel text-[11px] text-mute">the agent hasn&apos;t started its first shift yet</div>}
          {steps.filter((s) => compact ? s.kind !== "SHOT" : true).map((s) => <StepRow key={s.id} s={s} onShot={setPinned} />)}
          {running && <div className="cursor py-2 font-pixel text-[10px] text-mute">thinking</div>}
          {!running && run?.summary && <div className="mt-3 border-t-2 border-line pt-3 text-[13px] text-cream-dim"><span className="label mr-2 text-lime">shift summary</span>{run.summary}</div>}
        </div>
        {!follow && steps.length > 0 && (
          <button onClick={() => toLatest(true)} className="slide-in absolute bottom-3 right-4 border-2 border-cyan/60 bg-ink/95 px-2.5 py-1 font-pixel text-[10px] uppercase text-cyan shadow-[0_0_12px_rgba(56,217,255,.25)] hover:text-cream">
            ↓ latest{running ? " · live" : ""}
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
