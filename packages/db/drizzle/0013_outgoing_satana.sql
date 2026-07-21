CREATE TABLE "response_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "response_configs" ADD CONSTRAINT "response_configs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "response_configs_repo_unique" ON "response_configs" USING btree ("repo_id");