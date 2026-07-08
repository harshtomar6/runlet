import { env } from "../config/env";
import type { DecryptedSecret } from "../domain/types";
import type { AiConnector, AiInput, AiResult } from "./index";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * LLM completion via OpenRouter (OpenAI-compatible). One credential (`openrouter`,
 * secret `{ apiKey }`) reaches any model — `anthropic/claude-sonnet-4`,
 * `openai/gpt-4o-mini`, `google/gemini-2.0-flash`, etc. Falls back to
 * OPENROUTER_API_KEY; dry-runs when no key is available.
 */
export class OpenRouterAiConnector implements AiConnector {
  async complete(creds: DecryptedSecret | null, input: AiInput): Promise<AiResult> {
    const apiKey = (creds?.secret?.apiKey as string | undefined) ?? env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return { text: "[dry-run: no OpenRouter API key]", model: input.model, dryRun: true };
    }

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-title": "app-automations",
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: input.temperature,
        max_tokens: input.maxTokens,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
    };
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      model: input.model,
      usage: json.usage,
      dryRun: false,
    };
  }
}
