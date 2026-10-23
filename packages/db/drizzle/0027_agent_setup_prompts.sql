CREATE TABLE "agent_setup_prompts" (
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"first_dismissed_at" timestamp with time zone,
	"dismiss_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_setup_prompts_user_id_org_id_pk" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
ALTER TABLE "agent_setup_prompts" ADD CONSTRAINT "agent_setup_prompts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_setup_prompts" ADD CONSTRAINT "agent_setup_prompts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;