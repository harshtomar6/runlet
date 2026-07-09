import { and, eq } from "drizzle-orm";
import type { Connection, ConnectionMeta } from "../../domain/types";
import type { ConnectionStore, ConnectionTokenPatch, UpsertConnectionInput } from "../../ports";
import { NotFoundError } from "../../ports/errors";
import { decryptJson, encryptJson } from "../crypto";
import { db } from "./client";
import { connections } from "./schema";

type Row = typeof connections.$inferSelect;
type Secret = { accessToken: string; refreshToken: string | null; raw: Record<string, unknown> };

export class PostgresConnectionStore implements ConnectionStore {
  async upsert(input: UpsertConnectionInput): Promise<Connection> {
    const now = new Date();
    const ciphertext = encryptJson({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      raw: input.raw ?? {},
    });
    const values = {
      id: input.id,
      ownerId: input.ownerId,
      provider: input.provider,
      accountId: input.accountId,
      label: input.label,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
      ciphertext,
      createdAt: now,
      updatedAt: now,
    };
    const [row] = await db()
      .insert(connections)
      .values(values)
      .onConflictDoUpdate({
        target: [connections.ownerId, connections.provider, connections.accountId],
        set: { label: input.label, scopes: input.scopes, expiresAt: input.expiresAt, ciphertext, updatedAt: now },
      })
      .returning();
    return toConnection(row!);
  }

  async get(id: string, ownerId: string): Promise<Connection> {
    const [row] = await db()
      .select()
      .from(connections)
      .where(and(eq(connections.id, id), eq(connections.ownerId, ownerId)))
      .limit(1);
    if (!row) throw new NotFoundError("Connection", id);
    return toConnection(row);
  }

  async listByOwner(ownerId: string): Promise<ConnectionMeta[]> {
    const rows = await db()
      .select({
        id: connections.id,
        ownerId: connections.ownerId,
        provider: connections.provider,
        accountId: connections.accountId,
        label: connections.label,
        scopes: connections.scopes,
        expiresAt: connections.expiresAt,
        createdAt: connections.createdAt,
      })
      .from(connections)
      .where(eq(connections.ownerId, ownerId));
    return rows;
  }

  async delete(id: string, ownerId: string): Promise<Connection | null> {
    const [row] = await db()
      .delete(connections)
      .where(and(eq(connections.id, id), eq(connections.ownerId, ownerId)))
      .returning();
    return row ? toConnection(row) : null;
  }

  async updateTokens(id: string, patch: ConnectionTokenPatch): Promise<void> {
    const [row] = await db().select().from(connections).where(eq(connections.id, id)).limit(1);
    if (!row) throw new NotFoundError("Connection", id);
    const cur = decryptJson<Secret>(row.ciphertext);
    const next: Secret = {
      accessToken: patch.accessToken ?? cur.accessToken,
      refreshToken: patch.refreshToken !== undefined ? patch.refreshToken : cur.refreshToken,
      raw: patch.raw ?? cur.raw,
    };
    await db()
      .update(connections)
      .set({
        ciphertext: encryptJson(next),
        ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
        ...(patch.scopes ? { scopes: patch.scopes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(connections.id, id));
  }
}

function toConnection(r: Row): Connection {
  const secret = decryptJson<Secret>(r.ciphertext);
  return {
    id: r.id,
    ownerId: r.ownerId,
    provider: r.provider,
    accountId: r.accountId,
    label: r.label,
    scopes: r.scopes,
    accessToken: secret.accessToken,
    refreshToken: secret.refreshToken,
    expiresAt: r.expiresAt,
    raw: secret.raw ?? {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
