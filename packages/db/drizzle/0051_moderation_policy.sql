CREATE TABLE "organization_moderation_policies" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"policy" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_allowlist_entries" (
	"repo_id" text NOT NULL,
	"account_id" text NOT NULL,
	"login" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_allowlist_entries_repo_id_account_id_pk" PRIMARY KEY("repo_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "repository_moderation_policies" (
	"repo_id" text PRIMARY KEY NOT NULL,
	"policy" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_moderation_policies" ADD CONSTRAINT "organization_moderation_policies_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_allowlist_entries" ADD CONSTRAINT "repository_allowlist_entries_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_moderation_policies" ADD CONSTRAINT "repository_moderation_policies_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;