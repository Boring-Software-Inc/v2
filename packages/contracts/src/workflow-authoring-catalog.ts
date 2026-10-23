import { z } from "zod";
import type { EventKind } from "./events.ts";
import type { RULE_CATALOG } from "./rules.ts";
import {
	githubLoginSchema,
	githubTeamSlugSchema,
	labelParamsSchema,
	lockParamsSchema,
	postCommentParamsSchema,
	type RemovedActionKind,
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
} as const satisfies Record<
	Exclude<WorkflowActionKind, RemovedActionKind>,
	z.ZodType
>;
export type AuthoringActionKind = keyof typeof AUTHORING_ACTION_PARAMS;

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
