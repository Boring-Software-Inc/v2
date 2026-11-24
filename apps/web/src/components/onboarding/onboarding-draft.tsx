import type {
	OnboardingAnswers,
	OnboardingIntent,
	OnboardingReferral,
	OnboardingRole,
	OnboardingTeamSize,
	OnboardingUsage,
} from "@tripwire/contracts";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

export type AgentKey = "claude" | "cursor" | "chatgpt";

/** Where the connect step is: picking a forge, installing, syncing, picking repos. */
export type ConnectPhase = "forge" | "waiting" | "syncing" | "repos";

export interface ResponseChoices {
	block: boolean;
	review: boolean;
	close: boolean;
	fix: boolean;
}

/** A reported change request's re-run: started, refused for now, or failed to start. */
export type ReportRun =
	| { status: "starting" }
	| { status: "queued"; runId: string }
	| { status: "cooldown" }
	| { status: "error" };

/**
 * What the user is choosing right now, before it is saved. The form writes
 * it and the preview reads it, so the preview fills in as they type.
 */
export interface OnboardingDraft {
	intents: OnboardingIntent[];
	usage: OnboardingUsage | null;
	role: OnboardingRole | null;
	teamSize: OnboardingTeamSize | null;
	referral: OnboardingReferral | null;
	workspaceName: string;
	workspaceSlug: string;
	forge: "github" | "gitcafe";
	connectPhase: ConnectPhase;
	repoIds: string[];
	/** Rule picks switched on; null until touched, which means the recommended ones. */
	picks: string[] | null;
	reported: number[];
	runs: Record<number, ReportRun>;
	/** Which outcomes post a comment; null until touched, which means the repo's config. */
	responses: ResponseChoices | null;
	agent: AgentKey;
}

function initialDraft(
	answers: OnboardingAnswers,
	forge: OnboardingDraft["forge"],
): OnboardingDraft {
	return {
		intents: answers.intents,
		usage: answers.usage,
		role: answers.role,
		teamSize: answers.teamSize,
		referral: answers.referral,
		workspaceName: "",
		workspaceSlug: "",
		forge,
		connectPhase: "forge",
		repoIds: [],
		picks: null,
		reported: answers.reported,
		runs: {},
		responses: null,
		agent: "claude",
	};
}

type DraftPatch = Partial<OnboardingDraft>;

/** The draft, a patch setter, and one that derives its patch from the latest draft. */
type DraftContextValue = readonly [
	OnboardingDraft,
	(patch: DraftPatch) => void,
	(derive: (current: OnboardingDraft) => DraftPatch) => void,
];

const DraftContext = createContext<DraftContextValue | null>(null);

export function OnboardingDraftProvider({
	answers,
	forge,
	children,
}: {
	answers: OnboardingAnswers;
	/** The forge the connect step starts on. */
	forge: OnboardingDraft["forge"];
	children: ReactNode;
}) {
	const [draft, setDraft] = useState(() => initialDraft(answers, forge));
	const update = useCallback(
		(patch: DraftPatch) => setDraft((current) => ({ ...current, ...patch })),
		[],
	);
	const updateWith = useCallback(
		(derive: (current: OnboardingDraft) => DraftPatch) =>
			setDraft((current) => ({ ...current, ...derive(current) })),
		[],
	);
	const value = useMemo(
		() => [draft, update, updateWith] as const,
		[draft, update, updateWith],
	);
	return (
		<DraftContext.Provider value={value}>{children}</DraftContext.Provider>
	);
}

export function useOnboardingDraft(): DraftContextValue {
	const value = useContext(DraftContext);
	if (!value) {
		throw new Error("useOnboardingDraft needs an OnboardingDraftProvider");
	}
	return value;
}
