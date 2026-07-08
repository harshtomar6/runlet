import { Client } from "@upstash/workflow";
import { Hono } from "hono";
import { z } from "zod";
import { env } from "../../config/env";
import { ApiError } from "../../errors";
import { auth } from "../middleware/auth";
import { parseBody } from "../lib/parse";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const ApprovalSchema = z.object({
  eventId: z.string().min(1),
  approved: z.boolean().default(true),
  data: z.unknown().optional(),
});

/**
 * Deliver a human decision to a run waiting on `control.approval`.
 * In qstash mode this resumes the suspended run via QStash notify; in local mode
 * the run auto-approved already, so there's nothing to resume.
 */
export const approvals = new Hono<AppEnv>();
approvals.use("*", auth);

approvals.post("/", async (c) => {
  const input = await parseBody(c, ApprovalSchema);
  const payload = { approved: input.approved, data: input.data ?? null };

  if (env.DISPATCH_MODE !== "qstash") {
    return ok(c, { delivered: false, note: "local mode auto-approves; run not suspended" });
  }
  if (!env.QSTASH_TOKEN) throw new ApiError(503, "qstash_unset", "QSTASH_TOKEN required to deliver approvals");

  const client = new Client({ token: env.QSTASH_TOKEN });
  await client.notify({ eventId: input.eventId, eventData: payload });
  return ok(c, { delivered: true });
});
