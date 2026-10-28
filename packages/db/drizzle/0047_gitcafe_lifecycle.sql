CREATE TABLE "gitcafe_installation_lifecycle" (
	"installation_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_event_id" text,
	"authority_at" timestamp with time zone,
	"provider_version" integer,
	"provider_revision" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitcafe_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"event_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gitcafe_receipts_installation_event_unique" ON "gitcafe_receipts" USING btree ("installation_id","event_id");--> statement-breakpoint
CREATE INDEX "gitcafe_receipts_installation_status_idx" ON "gitcafe_receipts" USING btree ("installation_id","status");