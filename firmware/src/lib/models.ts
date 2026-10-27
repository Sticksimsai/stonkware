// Model catalog from OpenRouter. Creators pick provider → model at launch (fixed forever).
import { env } from "./env";

export type ModelInfo = { id: string; label: string; provider: string; inUsdPerM: number; outUsdPerM: number; context: number };

export const PROVIDERS: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  google: "Google (Gemini)",
  "x-ai": "xAI (Grok)",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  moonshotai: "Moonshot (Kimi)",
  mistralai: "Mistral",
  "meta-llama": "Meta (Llama)",
  meta: "Meta",
};

// Used only when the live catalog can't be fetched (offline dev). Live mode validates against the live catalog.
const FALLBACK: ModelInfo[] = [
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", provider: "anthropic", inUsdPerM: 15, outUsdPerM: 75, context: 200000 },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", provider: "anthropic", inUsdPerM: 3, outUsdPerM: 15, context: 200000 },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", provider: "openai", inUsdPerM: 2, outUsdPerM: 10, context: 400000 },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "google", inUsdPerM: 0.3, outUsdPerM: 2.5, context: 1000000 },
  { id: "x-ai/grok-4.7", label: "Grok 4.7", provider: "x-ai", inUsdPerM: 3, outUsdPerM: 15, context: 256000 },
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", provider: "deepseek", inUsdPerM: 0.3, outUsdPerM: 1.2, context: 128000 },
  { id: "qwen/qwen3.8-max-prime", label: "Qwen3.8 Max", provider: "qwen", inUsdPerM: 1.2, outUsdPerM: 6, context: 256000 },
];

let cache: { at: number; models: ModelInfo[]; live: boolean } | null = null;

type ORModel = { id: string; name: string; pricing?: { prompt?: string; completion?: string }; context_length?: number; supported_parameters?: string[] };

export async function listModels(): Promise<{ models: ModelInfo[]; live: boolean }> {
  if (cache && Date.now() - cache.at < 60 * 60_000) return cache;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { data: ORModel[] };
    const models = j.data
      .filter((m) => m.supported_parameters?.includes("tools"))
      .filter((m) => !m.id.includes(":") && !m.id.startsWith("~"))
      .map((m) => {
        const provider = m.id.split("/")[0];
        return {
          id: m.id,
          label: m.name.replace(/^[^:]+:\s*/, ""),
          provider,
          inUsdPerM: Number(m.pricing?.prompt ?? 0) * 1e6,
          outUsdPerM: Number(m.pricing?.completion ?? 0) * 1e6,
          context: m.context_length ?? 0,
        };
      })
      .filter((m) => PROVIDERS[m.provider]);
    cache = { at: Date.now(), models, live: true };
  } catch {
    cache = { at: Date.now() - 55 * 60_000, models: FALLBACK, live: false }; // retry in ~5 min
  }
  return cache;
}

export async function findModel(id: string): Promise<ModelInfo | null> {
  const { models } = await listModels();
  return models.find((m) => m.id === id) ?? null;
}

export const hasModelKey = () => !!env.openrouterKey;
