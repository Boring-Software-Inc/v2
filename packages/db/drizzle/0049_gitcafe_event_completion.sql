ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "processed_at" timestamp with time zone;
