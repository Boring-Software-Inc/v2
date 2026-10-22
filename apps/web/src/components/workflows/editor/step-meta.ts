import type {
	EventKind,
	GateMode,
	WorkflowActionKind,
	WorkflowNode,
} from "@tripwire/contracts";
import {
	ACTION_CATALOG,
	GATE_CATALOG,
	isScheduleTrigger,
	RULE_CATALOG,
} from "@tripwire/contracts";
import {
	Archive,
	Blocked,
	Bot,
	Branch,
	ChangeRequest,
	Checks,
	Comment,
	Commit,
	Converge,
	Conversation,
	DiscordMark,
	FailedMark,
	Files,
	Gauge,
	type GlazeIcon,
	Inbox,
	Invite,
	Lightning,
	Locked,
	Merge,
	Model,
	Negate,
	Play,
	Protected,
	Tag,
	Time,
	Translate,
	Tree,
	UserAvatar,
	Waiting,
	Wallet,
	Webhook,
} from "#/components/glaze/icon";

export type StepKind = WorkflowNode["type"];

export const KIND_ICON = {
	trigger: Lightning,
	rule: Protected,
	gate: Tree,
	action: Play,
} satisfies Record<StepKind, GlazeIcon>;

export const KIND_LABEL = {
	trigger: "Trigger",
	rule: "Rule",
	gate: "Gate",
	action: "Action",
} satisfies Record<StepKind, string>;

type TriggerIconMap = Partial<Record<EventKind, GlazeIcon>>;
const TRIGGER_ICON: TriggerIconMap = {
	"change-request.opened": ChangeRequest,
	"change-request.updated": Commit,
	"change-request.closed": Archive,
	"comment.created": Conversation,
	push: Branch,
	"schedule.matched": Time,
};

type RuleIconMap = Record<string, GlazeIcon>;
const RULE_ICON: RuleIconMap = {
	"account-age": Waiting,
	"min-merged-prs": Merge,
	"pr-rate-limit": Gauge,
	"max-files-changed": Files,
	"english-only": Translate,
	"crypto-address": Wallet,
	honeypot: Bot,
	"profile-readme": UserAvatar,
	"ai-review": Model,
};

const GATE_ICON = {
	"all-of": Checks,
	"any-of": Converge,
	not: Negate,
} satisfies Record<GateMode, GlazeIcon>;

const ACTION_ICON = {
	block: Blocked,
	comment: Comment,
	label: Tag,
	"request-review": Invite,
	"send-to-moderation": Inbox,
	webhook: Webhook,
	discord: DiscordMark,
	lock: Locked,
	close: FailedMark,
} satisfies Record<WorkflowActionKind, GlazeIcon>;

export function triggerIcon(kind: EventKind): GlazeIcon {
	return TRIGGER_ICON[kind] ?? Lightning;
}

export function ruleIcon(ref: string): GlazeIcon {
	const [ruleId = ""] = ref.split("@");
	return RULE_ICON[ruleId] ?? Protected;
}

export function gateIcon(mode: GateMode): GlazeIcon {
	return GATE_ICON[mode];
}

export function actionIcon(action: WorkflowActionKind): GlazeIcon {
	return ACTION_ICON[action];
}

export function stepIcon(node: WorkflowNode): GlazeIcon {
	switch (node.type) {
		case "trigger":
			return isScheduleTrigger(node) ? Time : KIND_ICON.trigger;
		case "rule":
			return ruleIcon(node.ref);
		case "gate":
			return gateIcon(node.mode);
		case "action":
			return actionIcon(node.action);
		default:
			return Lightning;
	}
}

export function stepName(
	node: WorkflowNode,
	customName: string | null,
): string {
	switch (node.type) {
		case "trigger":
			return "Trigger";
		case "rule": {
			const [ruleId] = node.ref.split("@");
			return (
				RULE_CATALOG.find((entry) => entry.ruleId === ruleId)?.name ??
				customName ??
				node.ref
			);
		}
		case "gate":
			return (
				GATE_CATALOG.find((entry) => entry.mode === node.mode)?.name ??
				node.mode
			);
		case "action":
			return (
				ACTION_CATALOG.find((entry) => entry.action === node.action)?.name ??
				node.action
			);
		default:
			return "";
	}
}
