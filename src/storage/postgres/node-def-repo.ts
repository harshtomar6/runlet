import { and, eq } from "drizzle-orm";
import type { CustomHttpRequest, CustomNodeDef, CustomNodeField } from "../../domain/types";
import type { NodeDefRepo } from "../../ports";
import { db } from "./client";
import { nodeDefs } from "./schema";

type Row = typeof nodeDefs.$inferSelect;

export class PostgresNodeDefRepo implements NodeDefRepo {
  async create(def: CustomNodeDef): Promise<void> {
    await db().insert(nodeDefs).values({
      id: def.id,
      ownerId: def.ownerId,
      type: def.type,
      label: def.label,
      app: def.app,
      category: def.category,
      description: def.description ?? null,
      fields: def.fields,
      request: def.request,
      outputs: def.outputs,
      createdAt: def.createdAt,
      updatedAt: def.updatedAt,
    });
  }

  async get(id: string, ownerId: string): Promise<CustomNodeDef | null> {
    const [row] = await db()
      .select()
      .from(nodeDefs)
      .where(and(eq(nodeDefs.id, id), eq(nodeDefs.ownerId, ownerId)))
      .limit(1);
    return row ? toDef(row) : null;
  }

  async listByOwner(ownerId: string): Promise<CustomNodeDef[]> {
    const rows = await db().select().from(nodeDefs).where(eq(nodeDefs.ownerId, ownerId));
    return rows.map(toDef);
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    const removed = await db()
      .delete(nodeDefs)
      .where(and(eq(nodeDefs.id, id), eq(nodeDefs.ownerId, ownerId)))
      .returning({ id: nodeDefs.id });
    return removed.length > 0;
  }
}

function toDef(r: Row): CustomNodeDef {
  return {
    id: r.id,
    ownerId: r.ownerId,
    type: r.type,
    label: r.label,
    app: r.app,
    category: r.category,
    description: r.description ?? undefined,
    fields: r.fields as CustomNodeField[],
    request: r.request as CustomHttpRequest,
    outputs: r.outputs as string[],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
