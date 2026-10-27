// Runs agent-written JavaScript in a QuickJS (WebAssembly) sandbox: no filesystem, network, process
// or Node APIs. Only the host functions we pass in exist, all async and JSON-in/JSON-out.
// Every run gets a fresh runtime with memory, stack and wall-clock limits.
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSWASMModule } from "quickjs-emscripten";

let mod: Promise<QuickJSWASMModule> | null = null;
const quickjs = () => (mod ??= getQuickJS());

export type HostFns = Record<string, (args: unknown[]) => Promise<unknown>>;
export type SandboxResult = { ok: true; value: unknown; logs: string[] } | { ok: false; error: string; logs: string[] };

const PRELUDE = `
const __call = (name, args) => __host(name, JSON.stringify(args)).then((s) => (s === "__undefined__" ? undefined : JSON.parse(s)));
const ai = (prompt, opts) => __call("ai", [String(prompt), opts || {}]);
const kv = {
  get: (k) => __call("kv.get", [String(k)]),
  set: (k, v) => __call("kv.set", [String(k), v]),
  del: (k) => __call("kv.del", [String(k)]),
  incr: (k, n) => __call("kv.incr", [String(k), n === undefined ? 1 : n]),
  list: (prefix) => __call("kv.list", [String(prefix || "")]),
};
const console = { log: (...a) => __log(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")) };
console.error = console.log; console.warn = console.log;
`;

/**
 * Evaluate `code`, then call `entry(input)` (sync or async) and return its JSON-serialisable result.
 * `globals` are injected as frozen JSON constants (e.g. company info).
 */
export async function runSandboxed(code: string, entry: string, input: unknown, host: HostFns, opts: { ms?: number; memoryMb?: number; globals?: Record<string, unknown> } = {}): Promise<SandboxResult> {
  const ms = opts.ms ?? 20_000;
  const QJ = await quickjs();
  const rt = QJ.newRuntime();
  rt.setMemoryLimit((opts.memoryMb ?? 24) * 1024 * 1024);
  rt.setMaxStackSize(512 * 1024);
  rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + ms));
  const ctx = rt.newContext();
  const logs: string[] = [];
  const open = new Set<{ dispose: () => void; alive: boolean }>();
  const pump = () => { if (ctx.alive) { const r = rt.executePendingJobs(); if (r.error) r.error.dispose(); } };

  const logFn = ctx.newFunction("__log", (h) => {
    if (logs.length < 50) logs.push(ctx.getString(h).slice(0, 500));
  });
  ctx.setProp(ctx.global, "__log", logFn);
  logFn.dispose();

  const hostFn = ctx.newFunction("__host", (nameH, argsH) => {
    const name = ctx.getString(nameH);
    const argsJson = ctx.getString(argsH);
    const d = ctx.newPromise();
    open.add(d);
    const fn = host[name];
    (async () => {
      if (!fn) throw new Error(`${name} is not available`);
      return fn(JSON.parse(argsJson) as unknown[]);
    })()
      .then((v) => {
        if (!ctx.alive) return;
        const h = ctx.newString(v === undefined ? "__undefined__" : JSON.stringify(v));
        d.resolve(h);
        h.dispose();
      })
      .catch((e) => {
        if (!ctx.alive) return;
        const h = ctx.newError((e as Error).message || String(e));
        d.reject(h);
        h.dispose();
      })
      .finally(() => { open.delete(d); if (d.alive) d.dispose(); pump(); });
    return d.handle;
  });
  ctx.setProp(ctx.global, "__host", hostFn);
  hostFn.dispose();

  const globals = Object.entries(opts.globals ?? {}).map(([k, v]) => `const ${k} = Object.freeze(${JSON.stringify(v)});`).join("\n");
  const wrapper = `
;(async () => {
  try {
    if (typeof ${entry} !== "function") throw new Error("define a function named ${entry}");
    const r = await ${entry}(globalThis.__input);
    globalThis.__out = JSON.stringify({ ok: true, value: r === undefined ? null : r });
  } catch (e) {
    globalThis.__out = JSON.stringify({ ok: false, error: String((e && e.message) || e) });
  }
})();`;

  try {
    const head = `${PRELUDE}\n${globals}\nglobalThis.__input = ${JSON.stringify(input ?? null)};\n`;
    const offset = head.split("\n").length - 1;
    const r = ctx.evalCode(`${head}${code}\n${wrapper}`, "bot.js");
    if (r.error) {
      const e = ctx.dump(r.error) as { name?: string; message?: string; lineNumber?: number } | string;
      r.error.dispose();
      const msg = typeof e === "string" ? e : `${e.name ?? "Error"}: ${e.message ?? ""}${e.lineNumber && e.lineNumber > offset ? ` (line ${e.lineNumber - offset})` : ""}`;
      return { ok: false, error: msg, logs };
    }
    r.value.dispose();
    pump();
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const o = ctx.getProp(ctx.global, "__out");
      const done = ctx.typeof(o) === "string" ? (JSON.parse(ctx.getString(o)) as { ok: boolean; value?: unknown; error?: string }) : null;
      o.dispose();
      if (done) return done.ok ? { ok: true, value: done.value, logs } : { ok: false, error: done.error ?? "error", logs };
      await new Promise((res) => setTimeout(res, 5));
    }
    return { ok: false, error: `timed out after ${ms / 1000}s`, logs };
  } catch (e) {
    return { ok: false, error: `sandbox: ${(e as Error).message}`, logs };
  } finally {
    for (const d of open) { try { if (d.alive) d.dispose(); } catch { /* ignore */ } }
    open.clear();
    try { ctx.dispose(); rt.dispose(); } catch { /* already gone */ }
  }
}
