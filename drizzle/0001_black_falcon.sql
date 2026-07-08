DROP INDEX IF EXISTS "subs_event_type_idx";--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD COLUMN "owner_id" text NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subs_owner_event_type_idx" ON "event_subscriptions" USING btree ("owner_id","event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subs_workflow_idx" ON "event_subscriptions" USING btree ("workflow_id");