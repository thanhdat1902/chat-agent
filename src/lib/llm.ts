import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

/**
 * ============================================================================
 * PROVIDER ABSTRACTION
 * ============================================================================
 * The memory system does not care which model runs. Permission filtering,
 * retrieval, and conflict resolution are all plain SQL and TypeScript — the
 * model is only used for two things: turning a message into structured rules,
 * and writing the reply.
 *
 * Whichever key is present wins, OpenAI first. With neither key set the app
 * still runs on deterministic fallbacks, so the permission demos never depend
 * on a provider being reachable.
 * ============================================================================
 */

export type Provider = "openai" | "anthropic" | "none";

export function activeProvider(): Provider {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "none";
}

export function modelName(): string {
  switch (activeProvider()) {
    case "openai":
      return process.env.OPENAI_MODEL ?? "gpt-5.5";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
    default:
      return "deterministic fallback";
  }
}

export function modelLabel(): string {
  const p = activeProvider();
  if (p === "none") return "No model key set — deterministic fallback agent";
  return `${p === "openai" ? "OpenAI" : "Anthropic"} · ${modelName()}`;
}

let _openai: OpenAI | null = null;
let _anthropic: Anthropic | null = null;

function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** Free-form completion. Returns null when no provider is configured. */
export async function completeText(
  system: string,
  messages: Turn[],
  maxTokens = 4000,
): Promise<string | null> {
  switch (activeProvider()) {
    case "openai": {
      const res = await openai().chat.completions.create({
        model: modelName(),
        max_completion_tokens: maxTokens,
        messages: [{ role: "system", content: system }, ...messages],
      });
      return res.choices[0]?.message?.content ?? null;
    }
    case "anthropic": {
      const res = await anthropic().messages.create({
        model: modelName(),
        // Thinking shares this budget on Opus 5, so leave headroom above the
        // couple of hundred tokens a chat reply actually needs.
        max_tokens: maxTokens,
        output_config: { effort: "low" },
        system,
        messages,
      });
      for (const block of res.content) if (block.type === "text") return block.text;
      return null;
    }
    default:
      return null;
  }
}

/**
 * Schema-constrained completion. The same JSON Schema drives both providers:
 * OpenAI's `json_schema` strict mode and Anthropic's `output_config.format`
 * accept the same shape, provided every object sets `additionalProperties:
 * false` and lists all of its keys in `required` — which the rule schema does.
 */
export async function completeJson<T>(
  system: string,
  user: string,
  schemaName: string,
  schema: Record<string, unknown>,
  maxTokens = 8000,
): Promise<T | null> {
  let text: string | null = null;

  switch (activeProvider()) {
    case "openai": {
      const res = await openai().chat.completions.create({
        model: modelName(),
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
      });
      text = res.choices[0]?.message?.content ?? null;
      break;
    }
    case "anthropic": {
      const res = await anthropic().messages.create({
        model: modelName(),
        max_tokens: maxTokens,
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        system,
        messages: [{ role: "user", content: user }],
      });
      for (const block of res.content) {
        if (block.type === "text") {
          text = block.text;
          break;
        }
      }
      break;
    }
    default:
      return null;
  }

  if (!text) return null;
  return JSON.parse(text) as T;
}
