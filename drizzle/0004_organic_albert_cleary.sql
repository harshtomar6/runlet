CREATE TABLE IF NOT EXISTS "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"account_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"scopes" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"ciphertext" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connections_owner_idx" ON "connections" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connections_owner_provider_account_idx" ON "connections" USING btree ("owner_id","provider","account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connections_provider_account_idx" ON "connections" USING btree ("provider","account_id");