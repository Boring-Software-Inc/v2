CREATE TABLE "ai_provider_status" (
	"provider" text PRIMARY KEY NOT NULL,
	"credits" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
