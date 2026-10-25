CREATE TABLE "rule_previews" (
	"repo_id" text PRIMARY KEY NOT NULL,
	"preview" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rule_previews" ADD CONSTRAINT "rule_previews_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;