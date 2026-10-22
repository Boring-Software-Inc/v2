CREATE TABLE "installation_access_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"forge" text DEFAULT 'github' NOT NULL,
	"installation_id" text NOT NULL,
	"result" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "installation_access_checks" ADD CONSTRAINT "installation_access_checks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "installation_access_checks_user_installation_unique" ON "installation_access_checks" USING btree ("user_id","forge","installation_id");