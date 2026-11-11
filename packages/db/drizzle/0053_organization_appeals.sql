CREATE TABLE "organization_appeals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"account_id" text NOT NULL,
	"type" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
ALTER TABLE "organization_appeals" ADD CONSTRAINT "organization_appeals_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_appeals" ADD CONSTRAINT "organization_appeals_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_appeals_org_resolved_idx" ON "organization_appeals" USING btree ("org_id","resolved_at");--> statement-breakpoint
CREATE INDEX "organization_appeals_account_resolved_idx" ON "organization_appeals" USING btree ("account_id","resolved_at");