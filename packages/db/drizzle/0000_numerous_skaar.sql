CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"forge" text DEFAULT 'github' NOT NULL,
	"external_id" text NOT NULL,
	"username" text NOT NULL,
	"credentials" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"forge" text DEFAULT 'github' NOT NULL,
	"delivery_id" text NOT NULL,
	"raw_kind" text NOT NULL,
	"raw" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text,
	"repo_full_name" text,
	"actor_login" text,
	"subject_number" integer,
	"head_sha" text,
	"normalized" jsonb,
	"normalized_at" timestamp with time zone,
	"quarantined" boolean DEFAULT false NOT NULL,
	"quarantine_reason" text
);
--> statement-breakpoint
CREATE TABLE "moderation_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" text PRIMARY KEY NOT NULL,
	"forge" text DEFAULT 'github' NOT NULL,
	"external_id" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"private" boolean DEFAULT false NOT NULL,
	"installation_id" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rule_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"version" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollups_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"day" date NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"blocked" integer DEFAULT 0 NOT NULL,
	"sent_to_review" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone,
	"external_id" text
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"node_kind" text NOT NULL,
	"rule_id" text,
	"status" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"evidence" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"subject_number" integer,
	"head_sha" text,
	"status" text DEFAULT 'running' NOT NULL,
	"verdict" text,
	"workflow_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_identities" ADD CONSTRAINT "forge_identities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_items" ADD CONSTRAINT "moderation_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_items" ADD CONSTRAINT "moderation_items_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_configs" ADD CONSTRAINT "rule_configs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollups_daily" ADD CONSTRAINT "rollups_daily_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_actions" ADD CONSTRAINT "run_actions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forge_identities_forge_external_unique" ON "forge_identities" USING btree ("forge","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_delivery_id_unique" ON "events" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "events_repo_received_idx" ON "events" USING btree ("repo_full_name","received_at");--> statement-breakpoint
CREATE INDEX "events_kind_idx" ON "events" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "moderation_items_status_idx" ON "moderation_items" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "repos_forge_external_unique" ON "repos" USING btree ("forge","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repos_forge_full_name_unique" ON "repos" USING btree ("forge","full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_configs_repo_rule_unique" ON "rule_configs" USING btree ("repo_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rollups_daily_repo_day_unique" ON "rollups_daily" USING btree ("repo_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "run_actions_idempotency_unique" ON "run_actions" USING btree ("run_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "run_actions_run_idx" ON "run_actions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "run_steps_run_idx" ON "run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_repo_created_idx" ON "runs" USING btree ("repo_full_name","created_at");--> statement-breakpoint
CREATE INDEX "runs_event_idx" ON "runs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "runs_head_sha_idx" ON "runs" USING btree ("head_sha");