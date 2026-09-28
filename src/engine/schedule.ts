import { Client as QStashClient } from "@upstash/qstash";
import { env } from "../config/env";
import type { KVState } from "../ports";
import { store as defaultStore } from "../storage/factory";

/**
 * Registers/removes cron schedules for workflows with a "schedule" trigger.
 * Local mode is a no-op (dev); QStash mode creates a schedule that POSTs to
 * the internal tick endpoint on each fire.
 */
export interface ScheduleManager {
  register(workflowId: string, cron: string): Promise<void>;
  unregister(workflowId: string): Promise<void>;
}

class NoopScheduleManager implements ScheduleManager {
  async register(workflowId: string, cron: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[schedule:noop] would register ${workflowId} @ "${cron}" (set DISPATCH_MODE=qstash)`);
  }
  async unregister(): Promise<void> {}
}

class QStashScheduleManager implements ScheduleManager {
  constructor(private readonly kv: KVState) {}

  private key(workflowId: string): string {
    return `schedule:${workflowId}`;
  }

  async register(workflowId: string, cron: string): Promise<void> {
    if (!env.QSTASH_TOKEN) throw new Error("QSTASH_TOKEN is required to register schedules");
    if (!env.PUBLIC_BASE_URL) throw new Error("PUBLIC_BASE_URL is required to register schedules");

    // Create-then-swap, so a failure at any step leaves the previous schedule in
    // place (re-activating a live workflow must not drop its schedule):
    //   read old id → create new → record new → delete old.
    const previousId = await this.kv.get(this.key(workflowId));
    const client = new QStashClient({ token: env.QSTASH_TOKEN });
    const res = await client.schedules.create({
      destination: `${env.PUBLIC_BASE_URL}/triggers/tick/${workflowId}`,
      cron,
      headers: env.INTERNAL_SECRET ? { "x-internal-secret": env.INTERNAL_SECRET } : undefined,
    });
    try {
      await this.kv.set(this.key(workflowId), res.scheduleId);
    } catch (err) {
      await client.schedules.delete(res.scheduleId).catch(() => {}); // don't orphan an untracked schedule
      throw err;
    }
    if (previousId && previousId !== res.scheduleId) {
      // Best effort: the new schedule is live and recorded; a leftover old one
      // would double-fire, so log loudly rather than fail the activation.
      await client.schedules.delete(previousId).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`[schedule] failed to delete previous schedule ${previousId} for ${workflowId}`, err);
      });
    }
  }

  async unregister(workflowId: string): Promise<void> {
    if (!env.QSTASH_TOKEN) return;
    const scheduleId = await this.kv.get(this.key(workflowId));
    if (!scheduleId) return;
    const client = new QStashClient({ token: env.QSTASH_TOKEN });
    await client.schedules.delete(scheduleId);
    await this.kv.del(this.key(workflowId));
  }
}

export function makeScheduleManager(kv: KVState): ScheduleManager {
  return env.DISPATCH_MODE === "qstash" ? new QStashScheduleManager(kv) : new NoopScheduleManager();
}

export const scheduleManager: ScheduleManager = makeScheduleManager(defaultStore.kv);
