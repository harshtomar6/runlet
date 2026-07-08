import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import type { DecryptedSecret } from "../domain/types";
import type { EmailConnector, EmailInput } from "./index";

/**
 * Resend-backed email connector. If no API key is available (either on the
 * credential or in env), it performs a dry-run so flows are runnable locally.
 */
export class ResendEmailConnector implements EmailConnector {
  async send(creds: DecryptedSecret | null, input: EmailInput): Promise<{ id: string; dryRun: boolean }> {
    const apiKey = (creds?.secret?.apiKey as string | undefined) ?? env.RESEND_API_KEY;
    if (!apiKey) {
      return { id: `dry_${randomUUID()}`, dryRun: true };
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: input.to,
        subject: input.subject ?? `Message: ${input.templateId}`,
        html: input.html ?? `<p>Template ${input.templateId}</p>`,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend send failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as { id?: string };
    return { id: json.id ?? randomUUID(), dryRun: false };
  }
}
