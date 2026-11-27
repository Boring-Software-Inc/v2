CREATE TABLE "ops_alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"firing" boolean NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
