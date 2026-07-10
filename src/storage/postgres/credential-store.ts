import { and, eq } from "drizzle-orm";
import type { CredentialMeta, DecryptedSecret } from "../../domain/types";
import type { CredentialStore, PutCredentialInput } from "../../ports";
import { NotFoundError } from "../../ports/errors";
import { decryptJson, encryptJson } from "../crypto";
import { db } from "./client";
import { credentials } from "./schema";

export class PostgresCredentialStore implements CredentialStore {
  async get(id: string, ownerId: string): Promise<DecryptedSecret> {
    // Owner-scoped: a workflow can only decrypt credentials owned by the run's
    // owner, even if another tenant's credentialId is referenced in node params.
    const [row] = await db()
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, id), eq(credentials.ownerId, ownerId)))
      .limit(1);
    if (!row) throw new NotFoundError("Credential", id);
    const secret = decryptJson<Record<string, unknown>>(row.ciphertext);
    return { id: row.id, type: row.type, secret };
  }

  async put(input: PutCredentialInput): Promise<void> {
    const ciphertext = encryptJson(input.secret);
    await db()
      .insert(credentials)
      .values({
        id: input.id,
        ownerId: input.ownerId,
        type: input.type,
        ciphertext,
      })
      .onConflictDoUpdate({
        target: credentials.id,
        set: { type: input.type, ciphertext },
      });
  }

  async list(ownerId: string): Promise<CredentialMeta[]> {
    // Include ciphertext so we can surface the secret's field NAMES (not values).
    const rows = await db().select().from(credentials).where(eq(credentials.ownerId, ownerId));
    return rows.map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      type: r.type,
      secretKeys: secretKeysOf(r.ciphertext),
      createdAt: r.createdAt,
    }));
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    const removed = await db()
      .delete(credentials)
      .where(and(eq(credentials.id, id), eq(credentials.ownerId, ownerId)))
      .returning({ id: credentials.id });
    return removed.length > 0;
  }
}

/** Top-level field names of an encrypted secret (values never exposed). */
function secretKeysOf(ciphertext: Buffer): string[] {
  try {
    return Object.keys(decryptJson<Record<string, unknown>>(ciphertext));
  } catch {
    return [];
  }
}
