CREATE TABLE "contribution_appeals" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_number" integer NOT NULL,
	"account_id" text NOT NULL,
	"login" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text
);
--> statement-breakpoint
ALTER TABLE "contribution_appeals" ADD CONSTRAINT "contribution_appeals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_appeals" ADD CONSTRAINT "contribution_appeals_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_appeals" ADD CONSTRAINT "contribution_appeals_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_appeals_run_unique" ON "contribution_appeals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "contribution_appeals_repo_status_idx" ON "contribution_appeals" USING btree ("repo_id","status");--> statement-breakpoint
CREATE INDEX "contribution_appeals_thread_idx" ON "contribution_appeals" USING btree ("repo_id","subject_kind","subject_number","account_id");