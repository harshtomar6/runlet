import { env } from "../config/env";
import type { DecryptedSecret } from "../domain/types";
import type {
  AiConnector,
  AiImageInput,
  AiImageResult,
  AiInput,
  AiResult,
  AiTranscribeInput,
  AiTranscribeResult,
  AiTtsInput,
  AiTtsResult,
} from "./index";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

interface ChatMessage {
  content?: string;
  images?: Array<{ image_url?: { url?: string } }>;
  audio?: { data?: string };
}
interface ChatResponse {
  choices?: Array<{ message?: ChatMessage }>;
  usage?: unknown;
}

/**
 * AI via OpenRouter (OpenAI-compatible /chat/completions). One `openrouter`
 * credential ({ apiKey }) reaches any model. Text, image-generation,
 * transcription (audio input), and TTS (audio output) are all expressed as
 * chat completions with the right modalities/content — so capability depends on
 * the model you pick. Falls back to OPENROUTER_API_KEY; dry-runs without a key.
 *
 * Note: OpenRouter has no video-generation API (use a dedicated provider).
 */
export class OpenRouterAiConnector implements AiConnector {
  async complete(creds: DecryptedSecret | null, input: AiInput): Promise<AiResult> {
    const apiKey = keyOf(creds);
    if (!apiKey) return { text: "[dry-run: no OpenRouter API key]", model: input.model, dryRun: true };
    const json = await call(apiKey, {
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
    });
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      model: input.model,
      usage: json.usage,
      dryRun: false,
    };
  }

  async image(creds: DecryptedSecret | null, input: AiImageInput): Promise<AiImageResult> {
    const apiKey = keyOf(creds);
    if (!apiKey) return { images: [], model: input.model, dryRun: true };
    const json = await call(apiKey, {
      model: input.model,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: input.prompt }],
    });
    const images = (json.choices?.[0]?.message?.images ?? [])
      .map((i) => i.image_url?.url)
      .filter((u): u is string => typeof u === "string");
    return { images, model: input.model, dryRun: false };
  }

  async transcribe(creds: DecryptedSecret | null, input: AiTranscribeInput): Promise<AiTranscribeResult> {
    const apiKey = keyOf(creds);
    if (!apiKey) return { text: "[dry-run]", model: input.model, dryRun: true };
    const json = await call(apiKey, {
      model: input.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt ?? "Transcribe this audio verbatim." },
            { type: "input_audio", input_audio: { data: input.audio, format: input.format } },
          ],
        },
      ],
    });
    return { text: json.choices?.[0]?.message?.content ?? "", model: input.model, dryRun: false };
  }

  async tts(creds: DecryptedSecret | null, input: AiTtsInput): Promise<AiTtsResult> {
    const apiKey = keyOf(creds);
    const format = input.format ?? "mp3";
    if (!apiKey) return { audio: "", format, model: input.model, dryRun: true };
    const json = await call(apiKey, {
      model: input.model,
      modalities: ["audio", "text"],
      audio: { voice: input.voice ?? "alloy", format },
      messages: [{ role: "user", content: input.text }],
    });
    return { audio: json.choices?.[0]?.message?.audio?.data ?? "", format, model: input.model, dryRun: false };
  }
}

function keyOf(creds: DecryptedSecret | null): string | undefined {
  return (creds?.secret?.apiKey as string | undefined) ?? env.OPENROUTER_API_KEY;
}

async function call(apiKey: string, body: Record<string, unknown>): Promise<ChatResponse> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-title": "app-automations",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  return (await res.json()) as ChatResponse;
}
