import { z } from "zod";
import { scheduleTimezoneSchema } from "./workflow.ts";

export const DATABUDDY_WEBSITE_ID = "09661145-7249-45d9-a9e3-f1a93e9c7266";

export const flagKeySchema = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

export const flagOverrideChoiceSchema = z.enum(["default", "on", "off"]);
export type FlagOverrideChoice = z.infer<typeof flagOverrideChoiceSchema>;

export const flagSyncStatusSchema = z.enum(["pending", "synced", "failed"]);
export type FlagSyncStatus = z.infer<typeof flagSyncStatusSchema>;

export const flagSourceSchema = z.enum([
	"default",
	"rule",
	"group",
	"rollout",
	"unknown",
]);
export type FlagSource = z.infer<typeof flagSourceSchema>;

export function flagSourceFromReason(
	reason: string | null | undefined,
): FlagSource {
	const value = (reason ?? "").toUpperCase();
	if (value.includes("GROUP")) {
		return "group";
	}
	if (
		value.includes("RULE") ||
		value.includes("USER") ||
		value.includes("MATCH")
	) {
		return "rule";
	}
	if (value.includes("ROLLOUT")) {
		return "rollout";
	}
	if (value.includes("DEFAULT")) {
		return "default";
	}
	return "unknown";
}

export const TRIPWIRE_RULE_FIELD = {
	on: "tripwire:override:on",
	off: "tripwire:override:off",
} as const;

export const databuddyRuleSchema = z.looseObject({
	type: z.enum(["user_id", "email", "property"]),
	operator: z.enum([
		"equals",
		"contains",
		"starts_with",
		"ends_with",
		"in",
		"not_in",
		"exists",
		"not_exists",
	]),
	field: z.string().optional(),
	value: z.string().optional(),
	values: z.array(z.string()).optional(),
	enabled: z.boolean(),
	batch: z.boolean(),
	batchValues: z.array(z.string()).optional(),
});
export type DatabuddyRule = z.infer<typeof databuddyRuleSchema>;

export const databuddyFlagSchema = z.looseObject({
	id: z.string(),
	key: z.string(),
	name: z.string().nullish(),
	description: z.string().nullish(),
	status: z.enum(["active", "inactive", "archived"]).optional(),
	defaultValue: z.boolean().optional(),
	rules: z.array(z.unknown()).nullish(),
});
export type DatabuddyFlag = z.infer<typeof databuddyFlagSchema>;

export const databuddyFlagListSchema = z.array(databuddyFlagSchema);

export function isTripwireRule(rule: unknown): boolean {
	if (typeof rule !== "object" || rule === null || !("field" in rule)) {
		return false;
	}
	const field = rule.field;
	return field === TRIPWIRE_RULE_FIELD.on || field === TRIPWIRE_RULE_FIELD.off;
}

export function mergeTripwireRules(
	existing: readonly unknown[],
	overrides: { on: readonly string[]; off: readonly string[] },
): unknown[] {
	const theirs = existing.filter((rule) => !isTripwireRule(rule));
	const ours: DatabuddyRule[] = [];
	const off = [...new Set(overrides.off)].sort();
	const on = [...new Set(overrides.on)].sort();
	if (off.length > 0) {
		ours.push({
			type: "user_id",
			operator: "in",
			field: TRIPWIRE_RULE_FIELD.off,
			values: off,
			enabled: false,
			batch: false,
		});
	}
	if (on.length > 0) {
		ours.push({
			type: "user_id",
			operator: "in",
			field: TRIPWIRE_RULE_FIELD.on,
			values: on,
			enabled: true,
			batch: false,
		});
	}
	return [...ours, ...theirs];
}

export const flagOverrideEventSchema = z.object({
	flagKey: flagKeySchema,
	from: flagOverrideChoiceSchema,
	to: flagOverrideChoiceSchema,
});

export const staffAuditActionSchema = z.enum([
	"access.approve",
	"access.decline",
	"flag.override",
	"flag.sync_retry",
	"account.timezone",
	"account.rerun_cooldown",
	"account.platform_admin",
	"session.revoke",
	"session.revoke_all",
	"agent.revoke",
	"user.ban",
	"user.unban",
	"user.delete",
	"impersonation.start",
	"impersonation.stop",
	"org.member_role",
]);
export type StaffAuditAction = z.infer<typeof staffAuditActionSchema>;

export const staffAuditDetailSchema = z.record(
	z.string(),
	z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export type StaffAuditDetail = z.infer<typeof staffAuditDetailSchema>;

export const staffUserIdSchema = z.string().min(1).max(200);

export const staffUserRefSchema = z.object({ userId: staffUserIdSchema });

export const staffSetFlagOverrideInputSchema = z.object({
	userId: staffUserIdSchema,
	flagKey: flagKeySchema,
	choice: flagOverrideChoiceSchema,
});

export const staffRetryFlagSyncInputSchema = z.object({
	userId: staffUserIdSchema,
	flagKey: flagKeySchema,
});

export const staffReviewAccessInputSchema = z.object({
	userIds: z.array(staffUserIdSchema).min(1).max(100),
	decision: z.enum(["approve", "reject"]),
});

export const staffSetTimezoneInputSchema = z.object({
	userId: staffUserIdSchema,
	timezone: scheduleTimezoneSchema.nullable(),
});

export const staffSetRerunExemptInputSchema = z.object({
	userId: staffUserIdSchema,
	exempt: z.boolean(),
});

export const staffSetPlatformAdminInputSchema = z.object({
	userId: staffUserIdSchema,
	isPlatformAdmin: z.boolean(),
	confirm: z.string().min(1).max(200),
});

export const staffRevokeSessionInputSchema = z.object({
	userId: staffUserIdSchema,
	sessionId: z.string().min(1).max(200),
});

export const staffRevokeAgentInputSchema = z.object({
	userId: staffUserIdSchema,
	clientId: z.string().min(1).max(200),
});

export const BAN_REASON_MAX = 500;

export const staffBanInputSchema = z.object({
	userId: staffUserIdSchema,
	reason: z.string().trim().min(1).max(BAN_REASON_MAX),
	endsAt: z.iso.date().nullable(),
});

export const staffDeleteUserInputSchema = z.object({
	userId: staffUserIdSchema,
	confirm: z.string().min(1).max(200),
});

export const databuddyAnonIdSchema = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[\w-]+$/);

export const recordAnonIdInputSchema = z.object({
	anonId: databuddyAnonIdSchema,
});

const looseRecord = z.record(z.string(), z.unknown());

export const databuddyQueryResultSchema = z.looseObject({
	success: z.boolean().optional(),
	data: z
		.array(
			z.looseObject({
				parameter: z.string().optional(),
				data: z.array(looseRecord).optional(),
			}),
		)
		.optional(),
});

export const databuddyErrorBodySchema = z.looseObject({
	message: z.string().optional(),
	error: z.string().optional(),
	json: z.looseObject({ message: z.string().optional() }).optional(),
});
