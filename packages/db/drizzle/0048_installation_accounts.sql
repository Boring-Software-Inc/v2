CREATE TABLE IF NOT EXISTS "installation_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"forge" text NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "installation_accounts_forge_installation_unique" ON "installation_accounts" USING btree ("forge","installation_id");