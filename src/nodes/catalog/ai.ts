import { z } from "zod";
import type { AiMessage } from "../../connectors";
import { defineNode } from "../define";

export const aiComplete = defineNode({
  type: "ai.complete",
  app: "ai",
  kind: "action",
  category: "AI",
  label: "AI Complete",
  description:
    "LLM completion via OpenRouter — any model (e.g. anthropic/claude-sonnet-4, openai/gpt-4o-mini). Requires an `openrouter` credential (or OPENROUTER_API_KEY).",
  inputSchema: z.object({
    model: z.string().min(1),
    prompt: z.string().optional(),
    system: z.string().optional(),
    messages: z
      .array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() }))
      .optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    credentialId: z.string().optional(),
  }),
  outputs: ["success", "error"],
  credentials: ["openrouter"],
  execute: async ({ inputs, params, rt }) => {
    const provided = inputs.messages as AiMessage[] | undefined;
    const messages: AiMessage[] =
      provided && provided.length > 0
        ? provided
        : [
            ...(inputs.system ? [{ role: "system" as const, content: String(inputs.system) }] : []),
            { role: "user" as const, content: String(inputs.prompt ?? "") },
          ];
    if (!inputs.prompt && !(provided && provided.length > 0)) {
      throw new Error("ai.complete requires `prompt` or `messages`");
    }

    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId)) : null;
    const res = await rt.connectors.ai.complete(creds, {
      model: String(inputs.model),
      messages,
      temperature: inputs.temperature as number | undefined,
      maxTokens: inputs.maxTokens as number | undefined,
    });
    return { data: res, port: "success" };
  },
});

export const aiImage = defineNode({
  type: "ai.image",
  app: "ai",
  kind: "action",
  category: "AI",
  label: "AI Image",
  description:
    "Generate image(s) via an OpenRouter image model (e.g. google/gemini-2.5-flash-image-preview). Returns image URLs / data URLs.",
  inputSchema: z.object({
    model: z.string().min(1),
    prompt: z.string().min(1),
    credentialId: z.string().optional(),
  }),
  outputs: ["success", "error"],
  credentials: ["openrouter"],
  execute: async ({ inputs, params, rt }) => {
    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId)) : null;
    const res = await rt.connectors.ai.image(creds, {
      model: String(inputs.model),
      prompt: String(inputs.prompt),
    });
    return { data: res, port: "success" };
  },
});

export const aiTranscribe = defineNode({
  type: "ai.transcribe",
  app: "ai",
  kind: "action",
  category: "AI",
  label: "AI Transcribe",
  description:
    "Transcribe audio to text via an OpenRouter audio-input model. `audio` is base64; `format` e.g. mp3/wav.",
  inputSchema: z.object({
    model: z.string().min(1),
    audio: z.string().min(1),
    format: z.string().default("mp3"),
    prompt: z.string().optional(),
    credentialId: z.string().optional(),
  }),
  outputs: ["success", "error"],
  credentials: ["openrouter"],
  execute: async ({ inputs, params, rt }) => {
    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId)) : null;
    const res = await rt.connectors.ai.transcribe(creds, {
      model: String(inputs.model),
      audio: String(inputs.audio),
      format: String(inputs.format ?? "mp3"),
      prompt: inputs.prompt as string | undefined,
    });
    return { data: res, port: "success" };
  },
});

export const aiTts = defineNode({
  type: "ai.tts",
  app: "ai",
  kind: "action",
  category: "AI",
  label: "AI Text-to-Speech",
  description:
    "Synthesize speech via an OpenRouter audio-output model. Returns base64 audio. (Model must support audio output.)",
  inputSchema: z.object({
    model: z.string().min(1),
    text: z.string().min(1),
    voice: z.string().optional(),
    format: z.string().default("mp3"),
    credentialId: z.string().optional(),
  }),
  outputs: ["success", "error"],
  credentials: ["openrouter"],
  execute: async ({ inputs, params, rt }) => {
    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId)) : null;
    const res = await rt.connectors.ai.tts(creds, {
      model: String(inputs.model),
      text: String(inputs.text),
      voice: inputs.voice as string | undefined,
      format: String(inputs.format ?? "mp3"),
    });
    return { data: res, port: "success" };
  },
});

export const aiNodes = [aiComplete, aiImage, aiTranscribe, aiTts];
