ALTER TABLE "user" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "user_last_seen_at_idx" ON "user" USING btree ("last_seen_at");