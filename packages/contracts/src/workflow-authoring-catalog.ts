import { z } from "zod";
import type { EventKind } from "./events.ts";
import type { RULE_CATALOG } from "./rules.ts";
import {
	githubLoginSchema,
	githubTeamSlugSchema,
	labelParamsSchema,
	lockParamsSchema,
	noteParamsSchema,
	postCommentParamsSchema,
	type RemovedActionKind,
	requestFixParamsSchema,
	reviewerRefSchema,
	type triggerScheduleSchema,
	type WorkflowActionKind,
} from "./workflow.ts";
import { authoring } from "./workflow-authoring.ts";

/** The event kinds `on` accepts. Schedules start through `schedule()`. */
export const AUTHORING_EVENT_KINDS = [
	"change-request.opened",
	"change-request.updated",
	"change-request.closed",
	"comment.created",
	"push",
] as const satisfies readonly EventKind[];
export type AuthoringEventKind = (typeof AUTHORING_EVENT_KINDS)[number];

const noParams = z.object({});

/**
 * Params each action takes when written as code. Delivery URLs and signing
 * secrets are set in the app only: code never carries them, and a push keeps
 * the stored ones.
 */
export const AUTHORING_ACTION_PARAMS = {
	block: noParams,
	label: labelParamsSchema,
	"remove-label": labelParamsSchema,
	"request-review": z.object({
		reviewers: z
			.array(z.union([githubLoginSchema, reviewerRefSchema]))
			.optional(),
		teamReviewers: z.array(githubTeamSlugSchema).optional(),
	}),
	"post-comment": postCommentParamsSchema,
	lock: lockParamsSchema,
	close: noParams,
	webhook: noParams,
	discord: noParams,
	"send-to-moderation": noParams,
	"request-fix": requestFixParamsSchema,
	note: noteParamsSchema,
} as const satisfies Record<
	Exclude<WorkflowActionKind, RemovedActionKind>,
	z.ZodType
>;
export type AuthoringActionKind = keyof typeof AUTHORING_ACTION_PARAMS;

/** Actions whose settings live in the app only: a URL and its secret. */
export const APP_SETTINGS_ACTIONS = [
	"webhook",
	"discord",
] as const satisfies readonly AuthoringActionKind[];

/** Whether an action has anything to set, in code or in the app. */
export function actionTakesSettings(action: WorkflowActionKind): boolean {
	if (APP_SETTINGS_ACTIONS.some((kind) => kind === action)) {
		return true;
	}
	const entry = Object.entries(AUTHORING_ACTION_PARAMS).find(
		([kind]) => kind === action,
	);
	return entry ? Object.keys(entry[1].shape).length > 0 : false;
}

type BuiltInRuleConfigs = {
	[Entry in (typeof RULE_CATALOG)[number] as Entry["ruleId"]]: z.input<
		Entry["configSchema"]
	>;
};

type BuiltInActionParams = {
	[Kind in AuthoringActionKind]: z.input<
		(typeof AUTHORING_ACTION_PARAMS)[Kind]
	>;
};

/** The catalog the authoring helpers are typed from inside this repo. */
export interface TripwireCatalog {
	readonly rules: BuiltInRuleConfigs;
	readonly actions: BuiltInActionParams;
	readonly events: AuthoringEventKind;
	readonly schedule: z.input<typeof triggerScheduleSchema>;
}

/** The `tripwire.ts` helpers, bound to this repo's catalog. */
export const workflowAuthoring = authoring<TripwireCatalog>();
