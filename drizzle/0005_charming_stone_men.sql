CREATE TABLE IF NOT EXISTS "node_defs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"app" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"fields" jsonb NOT NULL,
	"request" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "node_defs_owner_idx" ON "node_defs" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "node_defs_owner_type_idx" ON "node_defs" USING btree ("owner_id","type");