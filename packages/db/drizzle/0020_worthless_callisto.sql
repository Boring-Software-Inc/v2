CREATE TABLE "repo_reviewers" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"github_user_id" bigint NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text NOT NULL,
	"permission" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_reviewers" ADD CONSTRAINT "repo_reviewers_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repo_reviewers_repo_user_unique" ON "repo_reviewers" USING btree ("repo_id","github_user_id");