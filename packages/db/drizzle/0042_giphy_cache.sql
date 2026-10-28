CREATE TABLE "giphy_budget" (
	"scope" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "giphy_budget_scope_window_start_pk" PRIMARY KEY("scope","window_start")
);
--> statement-breakpoint
CREATE TABLE "giphy_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"body" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giphy_fills" (
	"key" text PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "giphy_budget_window_idx" ON "giphy_budget" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "giphy_cache_expires_idx" ON "giphy_cache" USING btree ("expires_at");