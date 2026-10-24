ALTER TABLE "moderation_items" DROP CONSTRAINT "moderation_items_decided_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "moderation_items" ADD CONSTRAINT "moderation_items_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;