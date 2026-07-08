import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AiMessage, ToolDef } from "../../connectors";
import type { ConversationMessage } from "../../domain/types";
import { sendAlert } from "../../observability/alert";
import { defineNode } from "../define";
import { getNode } from "../registry";

const MEMORY_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

const memorySchema = z
  .object({ key: z.string().min(1), window: z.number().int().positive().max(200).optional() })
  .optional();

export const aiComplete = defineNode({
  type: "ai.complete",
  app: "ai",
  kind: "action",
  category: "AI",
  label: "AI Complete",
  description:
    "LLM completion via OpenRouter — any model (e.g. anthropic/claude-sonnet-4). Optional conversation `memory` keyed per user. Requires an `openrouter` credential (or OPENROUTER_API_KEY).",
  inputSchema: z.object({
    model: z.string().min(1),
    prompt: z.string().optional(),
    system: z.string().optional(),
    messages: z
      .array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() }))
      .optional(),
    memory: memorySchema, // { key, window } — persists turns across calls
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    credentialId: z.string().optional(),
  }),
  outputs: ["success", "error"],
  credentials: ["openrouter"],
  execute: async ({ inputs, params, rt }) => {
    const provided = inputs.messages as AiMessage[] | undefined;
    const mem = inputs.memory as { key: string; window?: number } | undefined;
    const window = mem?.window ?? 20;

    // Owner-scoped memory key so conversations can't cross tenants.
    const memKey = mem?.key ? `${rt.ownerId}:${mem.key}` : undefined;
    const history: ConversationMessage[] = memKey ? await rt.conversations.load(memKey, window) : [];

    const messages: AiMessage[] =
      provided && provided.length > 0
        ? provided
        : [
            ...(inputs.system ? [{ role: "system" as const, content: String(inputs.system) }] : []),
            ...history,
            ...(inputs.prompt !== undefined ? [{ role: "user" as const, content: String(inputs.prompt) }] : []),
          ];
    if (!provided?.length && inputs.prompt === undefined && history.length === 0) {
      throw new Error("ai.complete requires `prompt` or `messages`");
    }

    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId)) : null;
    const res = await rt.connectors.ai.complete(creds, {
      model: String(inputs.model),
      messages,
      temperature: inputs.temperature as number | undefined,
      maxTokens: inputs.maxTokens as number | undefined,
    });

    if (memKey && inputs.prompt !== undefined) {
      await rt.conversations.append(
        memKey,
        [
          { role: "user", content: String(inputs.prompt) },
          { role: "assistant", content: res.text },
        ],
        { maxMessages: window * 2, ttlSec: MEMORY_TTL_SEC },
      );
    }
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

const toolName = (nodeType: string): string => nodeType.replace(/[^a-zA-Z0-9_-]/g, "_");

export const aiAgent = defineNode({
  type: "ai.agent",
  app: "ai",
  kind: "action",
  category: "AI",
  label: "AI Agent",
  description:
    "Runs a bounded tool-calling loop: the model may call the allowed catalog nodes as tools until it answers. Requires an `openrouter` credential.",
  inputSchema: z.object({
    model: z.string().min(1),
    prompt: z.string().min(1),
    system: z.string().optional(),
    // Allowlist: only these node types are callable as tools. Set
    // `requireApproval` to pause for a human before that tool runs.
    tools: z
      .array(
        z.object({
          tool: z.string().min(1),
          credentialId: z.string().optional(),
          requireApproval: z.boolean().optional(),
        }),
      )
      .default([]),
    maxSteps: z.number().int().positive().max(20).default(6),
    approvalTimeoutSec: z.number().int().positive().max(2_592_000).default(86_400),
    credentialId: z.string().optional(),
  }),
  outputs: ["success", "error"],
  credentials: ["openrouter"],
  durable: true, // each round + tool call is a checkpointed sub-step
  execute: async ({ inputs, params, rt }) => {
    const toolConfigs = (inputs.tools ?? []) as Array<{
      tool: string;
      credentialId?: string;
      requireApproval?: boolean;
    }>;
    const maxSteps = (inputs.maxSteps as number | undefined) ?? 6;
    const approvalTimeoutSec = (inputs.approvalTimeoutSec as number | undefined) ?? 86_400;
    const step = rt.step ?? (<T>(_id: string, fn: () => Promise<T>) => fn()); // inline fallback
    const wait = rt.waitForEvent ?? (async () => ({ timedOut: false, data: { approved: true, auto: true } }));

    // Build tool schemas from the allowlisted nodes (schema = node inputSchema).
    const bySanitized = new Map<string, { nodeType: string; credentialId?: string; requireApproval?: boolean }>();
    const toolDefs: ToolDef[] = [];
    for (const tc of toolConfigs) {
      const def = getNode(tc.tool);
      if (!def) throw new Error(`ai.agent: unknown tool node "${tc.tool}"`);
      const name = toolName(tc.tool);
      bySanitized.set(name, { nodeType: tc.tool, credentialId: tc.credentialId, requireApproval: tc.requireApproval });
      toolDefs.push({
        name,
        description: def.description ?? def.label,
        parameters: zodToJsonSchema(def.inputSchema),
      });
    }

    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId)) : null;
    const messages: Array<Record<string, unknown>> = [
      ...(inputs.system ? [{ role: "system", content: String(inputs.system) }] : []),
      { role: "user", content: String(inputs.prompt) },
    ];
    const trace: Array<{ tool: string; args: unknown; result: string; approved?: boolean }> = [];
    let text = "";

    for (let round = 0; round < maxSteps; round++) {
      // Each LLM round is its own durable step (resumable, not re-run on retry).
      const res = await step(`round-${round}`, () =>
        rt.connectors.ai.chat(creds, {
          model: String(inputs.model),
          messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
        }),
      );
      messages.push(res.message);
      if (res.toolCalls.length === 0) {
        text = res.content;
        break;
      }
      for (const call of res.toolCalls) {
        const mapping = bySanitized.get(call.name);

        // Human-in-the-loop: pause before a side-effecting tool if configured.
        if (mapping?.requireApproval) {
          const eventId = `approval:${rt.runId}:${rt.stepId}:tool:${round}:${call.id}`;
          await sendAlert("Tool approval requested", {
            eventId,
            runId: rt.runId,
            tool: mapping.nodeType,
            args: call.args,
          });
          const decision = await wait(eventId, approvalTimeoutSec);
          const detail = decision.data as { approved?: boolean; data?: unknown; feedback?: unknown } | null;
          const approved = !decision.timedOut && detail?.approved !== false;
          if (!approved) {
            // Surface the human's feedback (POST /approvals { data }) to the model
            // so it revises and re-attempts, rather than being denied blindly.
            const feedback = detail?.data ?? detail?.feedback ?? null;
            const content = JSON.stringify({
              approved: false,
              message: decision.timedOut
                ? "Approval timed out; the tool was not run."
                : feedback
                  ? "A human denied this call and requested changes. Revise using the feedback and try again."
                  : "A human denied this call.",
              feedback,
            });
            trace.push({ tool: mapping.nodeType, args: call.args, result: content, approved: false });
            messages.push({ role: "tool", tool_call_id: call.id, content });
            continue; // tell the model it was denied (+ feedback); don't run the tool
          }
        }

        // Each tool call is its own durable step too.
        const content = await step(`tool-${round}-${call.id}`, () =>
          runTool(bySanitized, call, rt, `${rt.stepId}:tool:${round}:${call.id}`),
        );
        trace.push({
          tool: mapping?.nodeType ?? call.name,
          args: call.args,
          result: content,
          approved: mapping?.requireApproval ? true : undefined,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }

    return { data: { text, steps: trace.length, toolCalls: trace }, port: "success" };
  },
});

async function runTool(
  bySanitized: Map<string, { nodeType: string; credentialId?: string; requireApproval?: boolean }>,
  call: { name: string; args: Record<string, unknown> },
  rt: import("../define").NodeRuntime,
  stepId: string,
): Promise<string> {
  const mapping = bySanitized.get(call.name);
  if (!mapping) return JSON.stringify({ error: `unknown tool "${call.name}"` });
  const def = getNode(mapping.nodeType);
  if (!def?.execute) return JSON.stringify({ error: `tool "${mapping.nodeType}" has no runtime` });
  const parsed = def.inputSchema.safeParse(call.args);
  if (!parsed.success) {
    return JSON.stringify({ error: "invalid arguments", details: parsed.error.flatten() });
  }
  try {
    const outcome = await def.execute({
      inputs: parsed.data as Record<string, unknown>,
      params: { credentialId: mapping.credentialId },
      rt: { ...rt, stepId }, // unique stepId so tool idempotency keys don't collide
    });
    return JSON.stringify(outcome.data ?? { ok: true });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

export const aiNodes = [aiComplete, aiImage, aiTranscribe, aiTts, aiAgent];
