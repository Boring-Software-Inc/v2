import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Card,
	CardAction,
	CardDescription,
	CardFooter,
	CardHeader,
	CardMeta,
	CardTitle,
} from "#/components/glaze/ui/card";
import { StatusMark } from "#/components/glaze/ui/status";
import { RulePacks } from "#/components/rules/rule-packs";
import { AgentSetupCard } from "#/components/setup/agent-setup-card";
import {
	FirstCheckAction,
	InstallAction,
	ResponsesAction,
} from "#/components/setup/setup-step-actions";
import { StepDoneMark } from "#/components/setup/step-done-mark";
import {
	useSetupInstallRules,
	useTakeOver,
} from "#/components/setup/use-repo-setup";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { useTimezones } from "#/hooks/use-timezones";
import { cn } from "#/lib/glaze/utils";
import {
	agentActivity,
	formatStepTime,
	type RepoSetupProgress,
	type SetupStep,
	stepCompletedAt,
} from "#/lib/repo-setup";
import type { RepoSetupState } from "#/lib/repo-setup.functions";
import {
	ruleConfigsQueryOptions,
	ruleLibraryQueryOptions,
} from "#/lib/rules.query";

interface ChecklistProps {
	org: string;
	repo: string;
	state: RepoSetupState;
	progress: RepoSetupProgress;
}

type StepTone = "done" | "current" | "later";

function toneOf(step: SetupStep, progress: RepoSetupProgress): StepTone {
	if (step.done) {
		return "done";
	}
	return progress.current?.key === step.key ? "current" : "later";
}

export function SetupStepList({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<ol aria-label="Setup steps" className={cn("flex flex-col", className)}>
			{children}
		</ol>
	);
}

export function SetupStepRow({
	tone,
	title,
	detail,
	children,
}: {
	tone: StepTone;
	title: ReactNode;
	detail?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<li
			aria-current={tone === "current" ? "step" : undefined}
			className="grid grid-cols-[--spacing(8)_minmax(0,1fr)] border-line-faint border-b py-4"
		>
			<span className="flex h-lh items-center type-body">
				{tone === "done" ? <StepDoneMark /> : null}
			</span>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span
					className={cn(
						"type-body",
						tone === "current" && "font-medium text-text-1",
						tone === "done" && "text-text-1",
						tone === "later" && "text-text-2",
					)}
				>
					{title}
				</span>
				{detail ? (
					<span className="type-body-sm text-text-2">{detail}</span>
				) : null}
				{children ? <div className="pt-3">{children}</div> : null}
			</div>
		</li>
	);
}

function RulesStep({
	org,
	repo,
	state,
}: {
	org: string;
	repo: string;
	state: RepoSetupState;
}) {
	const repoId = state.repoId;
	const canEdit = useOrgPermission(org, "rules:manage");
	const rules = useQuery(ruleConfigsQueryOptions(org, repoId));
	const library = useQuery(ruleLibraryQueryOptions(org, repoId));
	const { install, pending } = useSetupInstallRules({
		org,
		repo,
		repoId,
		armed: state.facts.armed,
	});
	return (
		<RulePacks
			canEdit={canEdit}
			heading={false}
			onInstall={install}
			pending={pending}
			preview={library.data?.preview ?? null}
			rules={rules.data ?? []}
		/>
	);
}

function currentAction(
	step: SetupStep,
	props: { org: string; repo: string; state: RepoSetupState },
): ReactNode {
	switch (step.key) {
		case "install":
			return <InstallAction org={props.org} />;
		case "rules":
			return <RulesStep {...props} />;
		case "check":
			return <FirstCheckAction {...props} />;
		case "responses":
			return <ResponsesAction {...props} />;
	}
}

function ManualChecklist({ org, repo, state, progress }: ChecklistProps) {
	return (
		<>
			<header className="flex flex-col gap-1">
				<h1 className="type-title">Set up {repo}</h1>
			</header>
			<AgentSetupCard org={org} setupDone={false} />
			<SetupStepList>
				{progress.steps.map((step) => {
					const tone = toneOf(step, progress);
					return (
						<SetupStepRow
							detail={step.detail}
							key={step.key}
							title={step.title}
							tone={tone}
						>
							{tone === "current"
								? currentAction(step, { org, repo, state })
								: null}
						</SetupStepRow>
					);
				})}
			</SetupStepList>
		</>
	);
}

function AgentChecklist({ org, repo, state, progress }: ChecklistProps) {
	const agent = state.agent;
	const zone = useTimezones(org).display.zone;
	const takeOver = useTakeOver(org, repo);
	const canTakeOver = useOrgPermission(org, "connections:manage");
	if (!agent) {
		return null;
	}
	const activity = agentActivity(agent);
	const line = activity?.line ?? null;
	return (
		<>
			<header className="flex flex-col gap-1">
				<h1 className="type-title">Set up {repo}</h1>
			</header>
			<Card aria-live="polite">
				<CardHeader>
					<CardTitle>
						{agent.agentName ?? "Your agent"} is setting up {repo}
					</CardTitle>
					{line ? <CardDescription>{line}</CardDescription> : null}
					<CardAction>
						<StatusMark status="running" />
					</CardAction>
				</CardHeader>
				<CardFooter>
					<CardMeta>Started {formatStepTime(agent.startedAt, zone)}</CardMeta>
					<Button
						disabled={!canTakeOver}
						onClick={() => takeOver.mutate(agent.code)}
						pending={takeOver.isPending}
						pendingLabel="Taking over"
						size="sm"
						variant="secondary"
					>
						Take over
					</Button>
				</CardFooter>
			</Card>
			<SetupStepList>
				{progress.steps.map((step) => {
					const tone = toneOf(step, progress);
					const at = step.done ? stepCompletedAt(agent.stages, step.key) : null;
					const time = at ? formatStepTime(at, zone) : null;
					const detail =
						step.detail && time ? (
							<span className="flex flex-wrap gap-x-2">
								<span>{step.detail}</span>
								<span>{time}</span>
							</span>
						) : (
							(step.detail ?? time)
						);
					const working =
						tone === "current" && activity?.step === step.key && line;
					return (
						<SetupStepRow
							detail={detail}
							key={step.key}
							title={working ? line : step.title}
							tone={tone}
						/>
					);
				})}
			</SetupStepList>
		</>
	);
}

export function RepoSetupChecklist(props: ChecklistProps) {
	return props.state.agent ? (
		<AgentChecklist {...props} />
	) : (
		<ManualChecklist {...props} />
	);
}
