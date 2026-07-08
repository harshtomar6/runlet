import { Hono } from "hono";
import type { RunStatus } from "../../domain/types";
import { RunService } from "../../services/run-service";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const service = new RunService(store);
const MAX_LIMIT = 500;

function clampLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return undefined; // invalid → default
  return Math.min(n, MAX_LIMIT);
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export const runs = new Hono<AppEnv>();
runs.use("*", auth);

runs.get("/", async (c) => {
  const owner = c.get("ownerId");
  const workflowId = c.req.query("workflowId");
  const status = c.req.query("status") as RunStatus | undefined;
  const limit = clampLimit(c.req.query("limit"));
  const from = parseDate(c.req.query("from"));
  const to = parseDate(c.req.query("to"));
  return ok(c, await service.list(owner, { workflowId, status, limit, from, to }));
});

runs.get("/:id", async (c) => ok(c, await service.get(c.get("ownerId"), c.req.param("id"))));

runs.get("/:id/events", async (c) => ok(c, await service.events(c.get("ownerId"), c.req.param("id"))));

runs.post("/:id/cancel", async (c) => {
  await service.cancel(c.get("ownerId"), c.req.param("id"));
  return ok(c, { cancelled: true });
});
