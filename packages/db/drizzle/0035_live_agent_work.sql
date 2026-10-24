CREATE TABLE "agent_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"definition_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_signal_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"definition_id" text NOT NULL,
	"workflow_id" text,
	"name" text NOT NULL,
	"definition" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"last_change" jsonb,
	"created_by_user_id" text,
	"agent_client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "reduce_agent_motion" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_drafts" ADD CONSTRAINT "workflow_drafts_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_drafts" ADD CONSTRAINT "workflow_drafts_workflow_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_drafts" ADD CONSTRAINT "workflow_drafts_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_activity_agent_unique" ON "agent_activity" USING btree ("repo_id","definition_id","user_id","client_id");--> statement-breakpoint
CREATE INDEX "agent_activity_repo_signal_idx" ON "agent_activity" USING btree ("repo_id","last_signal_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_drafts_open_unique" ON "workflow_drafts" USING btree ("repo_id","definition_id") WHERE "workflow_drafts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "workflow_drafts_repo_idx" ON "workflow_drafts" USING btree ("repo_id");