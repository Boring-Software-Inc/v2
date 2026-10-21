CREATE TABLE "organization_response_defaults" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_response_defaults" ADD CONSTRAINT "organization_response_defaults_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_response_defaults_org_unique" ON "organization_response_defaults" USING btree ("organization_id");