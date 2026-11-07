CREATE TABLE "repo_sync_stamps" (
	"repo_id" text NOT NULL,
	"kind" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_sync_stamps_repo_id_kind_pk" PRIMARY KEY("repo_id","kind")
);
--> statement-breakpoint
ALTER TABLE "repo_sync_stamps" ADD CONSTRAINT "repo_sync_stamps_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;