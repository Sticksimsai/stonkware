// OpenRouter chat completions (OpenAI-compatible) with tool calling + per-call cost accounting.
import { env } from "../env";

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type Completion = { content: string; toolCalls: ToolCall[]; finish: string; costUsd: number };

export async function complete(model: string, messages: Msg[], tools: ToolDef[], maxTokens = 4000): Promise<Completion> {
  const r = await fetch(`${process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.siteUrl,
      "X-Title": "Hypeware",
    },
    body: JSON.stringify({
      model,
      messages,
      tools: tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
      max_tokens: maxTokens,
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const j = (await r.json()) as {
    error?: { message: string };
    choices?: { finish_reason: string; message: { content: string | null; tool_calls?: ToolCall[] } }[];
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
  };
  if (!r.ok || j.error || !j.choices?.length) throw new Error(`model error: ${j.error?.message ?? r.status}`);
  const m = j.choices[0].message;
  return { content: m.content ?? "", toolCalls: m.tool_calls ?? [], finish: j.choices[0].finish_reason, costUsd: j.usage?.cost ?? 0 };
}
