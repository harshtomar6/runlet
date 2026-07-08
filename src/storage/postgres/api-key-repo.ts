import { and, eq } from "drizzle-orm";
import type { ApiKey, ApiKeyMeta } from "../../domain/types";
import type { ApiKeyRepo } from "../../ports";
import { db } from "./client";
import { apiKeys } from "./schema";

export class PostgresApiKeyRepo implements ApiKeyRepo {
  async create(k: ApiKey): Promise<void> {
    await db().insert(apiKeys).values(k);
  }

  async findByHash(keyHash: string): Promise<ApiKey | null> {
    const [row] = await db().select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
    return row ?? null;
  }

  async listByOwner(ownerId: string): Promise<ApiKeyMeta[]> {
    return db()
      .select({
        id: apiKeys.id,
        ownerId: apiKeys.ownerId,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.ownerId, ownerId));
  }

  async revoke(id: string, ownerId: string): Promise<void> {
    await db()
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.ownerId, ownerId)));
  }
}
