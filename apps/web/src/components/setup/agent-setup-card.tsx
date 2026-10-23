import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	SETUP_STAGES,
	type SetupStage,
	type SetupStageStatus,
	type SetupStages,
	setupPrompt,
} from "@tripwire/contracts";
import { useEffect, useRef, useState } from "react";
import { Bot, Close, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { Status, type StatusValue } from "#/components/glaze/ui/status";
import {
	type AgentSetupPromptState,
	dismissAgentSetupPrompt,
} from "#/lib/setup.functions";
import {
	agentSetupPromptQueryOptions,
	SETUP_POLL_MS,
	setupQueryKeys,
	setupRunQueryOptions,
} from "#/lib/setup.query";
import { trackEvent } from "#/lib/track";

const STAGE_LABELS: Record<SetupStage, string> = {
	connect_mcp: "Connect your agent",
	install_app: "Install the GitHub App",
	sync_repos: "Sync repos",
	pick_rules: "Pick rules",
	turn_on_gate: "Turn on the gate",
	verify_check: "Check a pull request",
};

const STATUS_VIEW: Record<
	SetupStageStatus,
	{ status: StatusValue; word: string }
> = {
	active: { status: "running", word: "In progress" },
	waiting: { status: "waiting", word: "Waiting on you" },
	completed: { status: "ok", word: "Done" },
	skipped: { status: "idle", word: "Skipped" },
	failed: { status: "fail", word: "Stopped" },
};

const COPIED_MS = 2000;

function CopyPromptButton({
	prompt,
	hasRunCode,
}: {
	prompt: string;
	hasRunCode: boolean;
}) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	return (
		<Button
			onClick={async () => {
				await navigator.clipboard.writeText(prompt);
				trackEvent("setup_prompt_copied", { has_run_code: hasRunCode });
				setCopied(true);
				clearTimeout(timer.current);
				timer.current = setTimeout(() => setCopied(false), COPIED_MS);
			}}
			size="sm"
			type="button"
		>
			{copied ? "Copied" : "Copy setup prompt"}
		</Button>
	);
}

function SetupChecklist({ stages }: { stages: SetupStages }) {
	return (
		<ol aria-label="Setup progress" className="flex flex-col gap-2">
			{SETUP_STAGES.map((stage) => {
				const state = stages[stage];
				const view = state ? STATUS_VIEW[state.status] : null;
				return (
					<li className="flex flex-col gap-0.5" key={stage}>
						<div className="flex items-baseline justify-between gap-3">
							<span className="type-body">{STAGE_LABELS[stage]}</span>
							{view ? (
								<Status size="sm" status={view.status}>
									{view.word}
								</Status>
							) : null}
						</div>
						{state?.detail ? (
							<span className="type-body-sm text-text-2">{state.detail}</span>
						) : null}
					</li>
				);
			})}
		</ol>
	);
}

function useDismissPrompt(org: string) {
	const queryClient = useQueryClient();
	const key = setupQueryKeys.prompt(org);
	return useMutation({
		mutationFn: () => dismissAgentSetupPrompt({ data: { org } }),
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: key });
			const previous = queryClient.getQueryData<AgentSetupPromptState>(key);
			if (previous) {
				queryClient.setQueryData<AgentSetupPromptState>(key, {
					visible: false,
					reminder: false,
					dismissCount: Math.min(previous.dismissCount + 1, 2),
				});
			}
			return { previous };
		},
		onError: (_error, _vars, context) => {
			if (context?.previous) {
				queryClient.setQueryData(key, context.previous);
			}
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
	});
}

function useTrackShown(shown: boolean, reminder: boolean) {
	const tracked = useRef(false);
	useEffect(() => {
		if (shown && !tracked.current) {
			tracked.current = true;
			trackEvent("agent_setup_prompt_shown", { reminder });
		}
	}, [shown, reminder]);
}

export function AgentSetupCard({
	org,
	setupDone,
}: {
	org: string;
	setupDone: boolean;
}) {
	const { data: promptState } = useQuery(agentSetupPromptQueryOptions(org));
	const dismiss = useDismissPrompt(org);
	const visible = promptState?.visible ?? false;
	const reminder = promptState?.reminder ?? false;
	const undismissed = promptState?.dismissCount === 0;
	const { data } = useQuery({
		...setupRunQueryOptions(org, !setupDone && visible),
		enabled: visible || undismissed,
		refetchInterval: (query) => {
			const state = query.state.data;
			return state?.status === "ready" && state.run.completedAt
				? false
				: SETUP_POLL_MS;
		},
		refetchIntervalInBackground: false,
	});
	const run = data?.status === "ready" ? data.run : null;
	const started = run ? Object.keys(run.stages).length > 0 : false;
	const live = started && !run?.completedAt && undismissed;
	const shown = (visible && !(setupDone && !started)) || live;

	useTrackShown(shown, reminder);

	if (!shown) {
		return null;
	}

	const prompt = run ? setupPrompt({ org, code: run.code }) : setupPrompt();

	return (
		<Card aria-labelledby="agent-setup-heading">
			<CardContent className="flex flex-col gap-4">
				<div className="flex items-center justify-between gap-3">
					<h2
						className="flex items-center gap-2 type-heading-sm"
						id="agent-setup-heading"
					>
						<Icon icon={Bot} />
						Set up with your coding agent
					</h2>
					<div className="flex items-center gap-1">
						<CopyPromptButton hasRunCode={Boolean(run)} prompt={prompt} />
						<Button
							aria-label="Dismiss"
							onClick={() => {
								trackEvent("agent_setup_prompt_dismissed", {
									count: reminder ? 2 : 1,
								});
								dismiss.mutate();
							}}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<Icon icon={Close} />
						</Button>
					</div>
				</div>
				{started && run ? <SetupChecklist stages={run.stages} /> : null}
			</CardContent>
		</Card>
	);
}
