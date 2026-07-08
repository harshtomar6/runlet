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
  text: string;
}

export interface SlackConnector {
  post(creds: DecryptedSecret | null, input: SlackInput): Promise<{ ok: boolean; dryRun: boolean }>;
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

export interface Connectors {
  email: EmailConnector;
  slack: SlackConnector;
  http: HttpConnector;
  smtp: SmtpConnector;
}
