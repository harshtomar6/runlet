import { z } from "zod";

/**
 * Zod schemas for API request validation. These mirror the hand-written types
 * in domain/types.ts; z.infer of these is assignable to those types.
 */

export const PositionSchema = z.object({ x: z.number(), y: z.number() });

export const NodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  position: PositionSchema.optional(),
});

export const NodePortSchema = z.object({
  nodeId: z.string().min(1),
  port: z.string().min(1),
});

export const EdgeSchema = z.object({
  from: NodePortSchema,
  to: NodePortSchema,
});

export const TriggerConfigSchema = z.object({
  type: z.enum(["webhook", "schedule", "event", "manual"]),
  eventType: z.string().optional(),
  cron: z.string().optional(),
});

export const CreateWorkflowSchema = z.object({
  name: z.string().min(1),
  trigger: TriggerConfigSchema,
  nodes: z.array(NodeSchema).default([]),
  edges: z.array(EdgeSchema).default([]),
});

export const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  trigger: TriggerConfigSchema.optional(),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});

export const ActivateSchema = z.object({ versionId: z.string().min(1) });

export type CreateWorkflowInput = z.infer<typeof CreateWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof UpdateWorkflowSchema>;
