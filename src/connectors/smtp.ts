import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { DecryptedSecret } from "../domain/types";
import type { SmtpConnector, SmtpInput } from "./index";

/**
 * SMTP email via nodemailer. Credential secret shape:
 *   { host, port, user, pass, from, secure? }
 * Without a credential it dry-runs so flows stay runnable locally.
 */
export class NodemailerSmtpConnector implements SmtpConnector {
  async send(
    creds: DecryptedSecret | null,
    input: SmtpInput,
  ): Promise<{ messageId: string; dryRun: boolean }> {
    const s = creds?.secret as
      | { host?: string; port?: number; user?: string; pass?: string; from?: string; secure?: boolean }
      | undefined;
    if (!s?.host || !s.from) {
      return { messageId: `dry_${randomUUID()}`, dryRun: true };
    }
    const transport = nodemailer.createTransport({
      host: s.host,
      port: s.port ?? 587,
      secure: s.secure ?? (s.port === 465),
      auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    });
    const info = await transport.sendMail({
      from: s.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { messageId: info.messageId ?? randomUUID(), dryRun: false };
  }
}
