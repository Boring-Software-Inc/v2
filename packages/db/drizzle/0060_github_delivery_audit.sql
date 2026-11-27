CREATE TABLE "github_delivery_audit" (
	"guid" text PRIMARY KEY NOT NULL,
	"attempt_id" bigint NOT NULL,
	"event" text NOT NULL,
	"action" text,
	"installation_id" text,
	"repository_id" text,
	"delivered_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"status_code" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_cursors" (
	"key" text PRIMARY KEY NOT NULL,
	"position" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "github_delivery_audit_status_idx" ON "github_delivery_audit" USING btree ("status","updated_at");