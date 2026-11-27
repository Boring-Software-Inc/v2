CREATE TABLE "github_delivery_audit" (
	"guid" text PRIMARY KEY NOT NULL,
	"attempt_id" bigint NOT NULL,
	"event" text NOT NULL,
	"action" text,
	"installation_id" text,
	"repository_id" text,
	"delivered_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"status_code" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_cursors" (
	"key" text PRIMARY KEY NOT NULL,
	"position" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "routing_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "github_delivery_audit_status_idx" ON "github_delivery_audit" USING btree ("status","updated_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "repos_routing_changed"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	NEW.routing_changed_at := now();
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "repos_routing_changed"
	BEFORE UPDATE OF "armed", "org_id", "removed_at", "full_name" ON "repos"
	FOR EACH ROW
	WHEN (OLD.armed IS DISTINCT FROM NEW.armed
		OR OLD.org_id IS DISTINCT FROM NEW.org_id
		OR OLD.removed_at IS DISTINCT FROM NEW.removed_at
		OR OLD.full_name IS DISTINCT FROM NEW.full_name)
	EXECUTE FUNCTION "repos_routing_changed"();
