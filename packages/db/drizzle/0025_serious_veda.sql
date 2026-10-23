CREATE TABLE "repo_labels" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"description" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_schedule_state" (
	"workflow_id" text NOT NULL,
	"node_id" text NOT NULL,
	"last_tick_at" timestamp with time zone NOT NULL,
	"last_error" text,
	CONSTRAINT "workflow_schedule_state_workflow_id_node_id_pk" PRIMARY KEY("workflow_id","node_id")
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "subject_kind" text;--> statement-breakpoint
ALTER TABLE "repo_labels" ADD CONSTRAINT "repo_labels_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedule_state" ADD CONSTRAINT "workflow_schedule_state_workflow_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repo_labels_repo_name_unique" ON "repo_labels" USING btree ("repo_id","name");