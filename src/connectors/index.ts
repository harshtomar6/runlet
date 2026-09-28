import type { DecryptedSecret } from "../domain/types";

export interface EmailInput {
  to: string;
  templateId: string;
  vars?: Record<string, unknown>;
  subject?: string;
  html?: string;
}

export interface EmailConnector {
  send(creds: DecryptedSecret | null, input: EmailInput): Promise<{ id: string; dryRun: boolean }>;
}

export interface SlackInput {
  channel: string;
  text?: string;
  blocks?: unknown[]; // Block Kit
  threadTs?: string; // reply into a thread
  botToken?: string; // Web API (chat.postMessage) — from an OAuth connection; preferred
  webhookUrl?: string; // incoming-webhook fallback (no ts/threading)
}

export interface SlackResult {
  ok: boolean;
  ts?: string; // message timestamp = thread id (Web API only)
  channel?: string; // channel id (Web API only)
  dryRun: boolean;
}

export interface SlackConnector {
  post(input: SlackInput): Promise<SlackResult>;
}

export interface HttpInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HttpConnector {
  request(input: HttpInput): Promise<{ status: number; body: unknown }>;
}

export interface SmtpInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface SmtpConnector {
  send(creds: DecryptedSecret | null, input: SmtpInput): Promise<{ messageId: string; dryRun: boolean }>;
}

export interface PostgresQueryInput {
  query: string; // one statement, $1..$n placeholders
  values: unknown[];
  readOnly: boolean;
  maxRows: number;
  timeoutMs: number;
}

export interface PostgresQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number; // rows returned, or rows affected for writes without RETURNING
  command: string | null; // "SELECT", "INSERT", …
  truncated: boolean; // more rows existed than maxRows
  dryRun: boolean;
}

export interface PostgresConnector {
  query(creds: DecryptedSecret | null, input: PostgresQueryInput): Promise<PostgresQueryResult>;
}

export type MongoOperation =
  | "find"
  | "findOne"
  | "aggregate"
  | "count"
  | "distinct"
  | "insertOne"
  | "insertMany"
  | "updateOne"
  | "updateMany"
  | "deleteOne"
  | "deleteMany";

export interface MongoQueryInput {
  operation: MongoOperation;
  collection: string;
  database?: string; // overrides the credential / connection-string database
  filter: Record<string, unknown>; // Extended JSON
  projection?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  pipeline?: Record<string, unknown>[]; // aggregate
  field?: string; // distinct
  document?: Record<string, unknown>; // insertOne
  documents?: Record<string, unknown>[]; // insertMany
  update?: Record<string, unknown> | Record<string, unknown>[]; // update operators or pipeline
  upsert: boolean;
  readOnly: boolean;
  maxRows: number;
  timeoutMs: number;
}

/** `{ operation, dryRun }` plus operation-specific fields (rows, doc, count, …). */
export interface MongoQueryResult {
  operation: MongoOperation;
  dryRun: boolean;
  [key: string]: unknown;
}

export interface MongoConnector {
  query(creds: DecryptedSecret | null, input: MongoQueryInput): Promise<MongoQueryResult>;
}

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiInput {
  model: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AiResult {
  text: string;
  model: string;
  usage?: unknown;
  dryRun: boolean;
}

export interface AiImageInput {
  model: string;
  prompt: string;
}
export interface AiImageResult {
  images: string[]; // image URLs or data: URLs
  model: string;
  dryRun: boolean;
}

export interface AiTranscribeInput {
  model: string;
  audio: string; // base64-encoded audio
  format: string; // "mp3" | "wav" | ...
  prompt?: string;
}
export interface AiTranscribeResult {
  text: string;
  model: string;
  dryRun: boolean;
}

export interface AiTtsInput {
  model: string;
  text: string;
  voice?: string;
  format?: string; // "mp3" | "wav" | ...
}
export interface AiTtsResult {
  audio: string; // base64-encoded audio
  format: string;
  model: string;
  dryRun: boolean;
}

/** A tool the model may call (OpenAI function-calling shape). */
export interface ToolDef {
  name: string;
  description: string;
  parameters: unknown; // JSON Schema
}
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AiChatInput {
  model: string;
  messages: Array<Record<string, unknown>>; // OpenAI-format (may include tool_calls / tool role)
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
}
export interface AiChatResult {
  message: Record<string, unknown>; // raw assistant message (push back for the next turn)
  content: string;
  toolCalls: ToolCall[];
  dryRun: boolean;
}

export interface AiConnector {
  complete(creds: DecryptedSecret | null, input: AiInput): Promise<AiResult>;
  image(creds: DecryptedSecret | null, input: AiImageInput): Promise<AiImageResult>;
  transcribe(creds: DecryptedSecret | null, input: AiTranscribeInput): Promise<AiTranscribeResult>;
  tts(creds: DecryptedSecret | null, input: AiTtsInput): Promise<AiTtsResult>;
  /** Low-level chat used by the agent loop: passes messages through, returns tool calls. */
  chat(creds: DecryptedSecret | null, input: AiChatInput): Promise<AiChatResult>;
}

export interface Connectors {
  email: EmailConnector;
  slack: SlackConnector;
  http: HttpConnector;
  smtp: SmtpConnector;
  postgres: PostgresConnector;
  mongo: MongoConnector;
  ai: AiConnector;
}
