CREATE TABLE "flag_override_removals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"flag_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "flag_override_removals_user_flag_unique" ON "flag_override_removals" USING btree ("user_id","flag_key");--> statement-breakpoint
CREATE INDEX "flag_override_removals_flag_idx" ON "flag_override_removals" USING btree ("flag_key","created_at");