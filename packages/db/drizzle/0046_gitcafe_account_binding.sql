CREATE UNIQUE INDEX IF NOT EXISTS "account_gitcafe_subject_unique" ON "account" USING btree ("provider_id","account_id") WHERE "account"."provider_id" = 'gitcafe';
