import { env } from "../config/env";
import type { CredentialStore, EventLog, Store, SubscriptionRepo, WorkflowRepo } from "../ports";
import { PostgresCredentialStore } from "./postgres/credential-store";
import { PostgresEventLog } from "./postgres/event-log";
import { PostgresSubscriptionRepo } from "./postgres/subscription-repo";
import { PostgresWorkflowRepo } from "./postgres/workflow-repo";
import { RedisKVState } from "./redis/kv-state";

function mkWorkflowRepo(kind: string): WorkflowRepo {
  switch (kind) {
    case "postgres":
      return new PostgresWorkflowRepo();
    default:
      throw new Error(`Unknown WORKFLOW_STORE adapter: ${kind}`);
  }
}

function mkEventLog(kind: string): EventLog {
  switch (kind) {
    case "postgres":
      return new PostgresEventLog();
    default:
      throw new Error(`Unknown EVENT_STORE adapter: ${kind}`);
  }
}

function mkCredentialStore(kind: string): CredentialStore {
  switch (kind) {
    case "postgres":
      return new PostgresCredentialStore();
    default:
      throw new Error(`Unknown CRED_STORE adapter: ${kind}`);
  }
}

function mkSubscriptionRepo(kind: string): SubscriptionRepo {
  switch (kind) {
    case "postgres":
      return new PostgresSubscriptionRepo();
    default:
      throw new Error(`Unknown WORKFLOW_STORE adapter: ${kind}`);
  }
}

/**
 * The single Store instance the app depends on. Adapters connect lazily, so
 * constructing this at import time performs no I/O.
 */
export const store: Store = {
  workflows: mkWorkflowRepo(env.WORKFLOW_STORE),
  events: mkEventLog(env.EVENT_STORE),
  credentials: mkCredentialStore(env.CRED_STORE),
  subscriptions: mkSubscriptionRepo(env.WORKFLOW_STORE),
  kv: new RedisKVState(), // hot state is always Redis (see DESIGN.md §5)
};
