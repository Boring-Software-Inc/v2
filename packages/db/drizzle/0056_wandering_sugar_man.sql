ALTER TABLE "events" ADD COLUMN "processing_comment" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "stall_reported_at" timestamp with time zone;