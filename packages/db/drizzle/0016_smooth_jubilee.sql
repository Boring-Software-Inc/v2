CREATE TABLE "ai_review_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"run_step_id" text NOT NULL,
	"run_id" text NOT NULL,
	"org_id" text,
	"model" text NOT NULL,
	"http_requests" integer NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"cached_tokens" integer,
	"cost_usd" numeric(10, 6),
	"source" text DEFAULT 'prod' NOT NULL,
	"backfilled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economics_daily" (
	"day" date NOT NULL,
	"org_id" text,
	"runs" integer DEFAULT 0 NOT NULL,
	"ai_reviewed_runs" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"metered_cost_usd" numeric(10, 6) NOT NULL,
	"unattributed_runs" integer,
	"unattributed_cost_usd" numeric(10, 6),
	"pulled_cost_usd" numeric(10, 4),
	"drift_pct" numeric(5, 2),
	"credit_balance_usd" numeric(8, 2),
	"railway_usage_usd" numeric(6, 2)
);
--> statement-breakpoint
CREATE TABLE "provider_costs_daily" (
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"service" text NOT NULL,
	"usage_json" jsonb NOT NULL,
	"cost_usd" numeric(10, 4) NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"pulled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_costs_daily_day_provider_service_pk" PRIMARY KEY("day","provider","service")
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"run_id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"github_api_calls" integer DEFAULT 0 NOT NULL,
	"github_bytes_in" integer DEFAULT 0 NOT NULL,
	"github_bytes_out" integer DEFAULT 0 NOT NULL,
	"openrouter_bytes_out" integer DEFAULT 0 NOT NULL,
	"active_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_review_usage" ADD CONSTRAINT "ai_review_usage_run_step_id_run_steps_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_usage" ADD CONSTRAINT "ai_review_usage_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_usage_run_step_unique" ON "ai_review_usage" USING btree ("run_step_id");--> statement-breakpoint
CREATE INDEX "ai_review_usage_org_created_idx" ON "ai_review_usage" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_review_usage_run_idx" ON "ai_review_usage" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ai_review_usage_source_created_idx" ON "ai_review_usage" USING btree ("source","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "economics_daily_day_org_unique" ON "economics_daily" USING btree ("day",coalesce("org_id", '~platform'));--> statement-breakpoint
CREATE INDEX "economics_daily_org_idx" ON "economics_daily" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "usage_counters_org_created_idx" ON "usage_counters" USING btree ("org_id","created_at");