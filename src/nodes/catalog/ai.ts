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

export const aiNodes = [aiComplete];
