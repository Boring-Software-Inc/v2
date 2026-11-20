CREATE TABLE "gitcafe_recovery_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"request_id" text NOT NULL,
	"audit" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitcafe_runtime_heartbeats" (
	"runtime_id" text PRIMARY KEY NOT NULL,
	"release" text NOT NULL,
	"mode" text NOT NULL,
	"progress_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "processing_settlement" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "recovery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "next_recovery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gitcafe_receipts" ADD COLUMN "recovery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gitcafe_receipts" ADD COLUMN "next_recovery_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "gitcafe_recovery_audit_request_receipt_unique" ON "gitcafe_recovery_audit" USING btree ("request_id","receipt_id");