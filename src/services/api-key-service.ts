import { createHash, randomBytes } from "node:crypto";
import { newId } from "../domain/ids";
import type { ApiKey, ApiKeyMeta } from "../domain/types";
import type { Store } from "../ports";

export interface IssuedKey {
  id: string;
  key: string; // plaintext — shown once, never stored
  prefix: string;
}

/** Issues and verifies API keys. Only the SHA-256 hash is persisted. */
export class ApiKeyService {
  constructor(private readonly store: Store) {}

  async issue(ownerId: string, name: string): Promise<IssuedKey> {
    const secret = randomBytes(24).toString("base64url");
    const key = `ak_${secret}`;
    const prefix = key.slice(0, 11);
    const record: ApiKey = {
      id: newId(),
      ownerId,
      name,
      prefix,
      keyHash: hashKey(key),
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
    };
    await this.store.apiKeys.create(record);
    return { id: record.id, key, prefix };
  }

  /** Returns the owning id for a valid, non-revoked key, else null. */
  async verify(presentedKey: string): Promise<{ ownerId: string } | null> {
    const record = await this.store.apiKeys.findByHash(hashKey(presentedKey));
    if (!record || record.revokedAt) return null;
    return { ownerId: record.ownerId };
  }

  async list(ownerId: string): Promise<ApiKeyMeta[]> {
    return this.store.apiKeys.listByOwner(ownerId);
  }

  async revoke(ownerId: string, id: string): Promise<void> {
    await this.store.apiKeys.revoke(id, ownerId);
  }
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
