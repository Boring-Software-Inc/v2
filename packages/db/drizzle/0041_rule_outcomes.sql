ALTER TABLE "custom_rules" ADD COLUMN "outcome" text DEFAULT 'block' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_rules" ADD COLUMN "outcome_instruction" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_configs" ADD COLUMN "outcome" text DEFAULT 'block' NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_configs" ADD COLUMN "outcome_instruction" text DEFAULT '' NOT NULL;