ALTER TABLE "runs" ADD COLUMN "owner_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_owner_idx" ON "runs" USING btree ("owner_id");