CREATE TABLE "staff_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"target_user_id" text,
	"action" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_flag_override_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"flag_key" text NOT NULL,
	"from_value" text NOT NULL,
	"to_value" text NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_flag_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"flag_key" text NOT NULL,
	"value" boolean,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"sync_error" text,
	"sync_attempts" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "databuddy_anon_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "databuddy_anon_id_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_flag_override_events" ADD CONSTRAINT "user_flag_override_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_flag_overrides" ADD CONSTRAINT "user_flag_overrides_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_audit_log_target_idx" ON "staff_audit_log" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_audit_log_actor_idx" ON "staff_audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "user_flag_override_events_user_idx" ON "user_flag_override_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_flag_overrides_user_flag_unique" ON "user_flag_overrides" USING btree ("user_id","flag_key");--> statement-breakpoint
CREATE INDEX "user_flag_overrides_flag_idx" ON "user_flag_overrides" USING btree ("flag_key");