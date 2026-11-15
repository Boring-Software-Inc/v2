import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@tripwire/ui/button";
import { DestructiveDialog, Dialog } from "@tripwire/ui/dialog";
import { External, Icon } from "@tripwire/ui/icon";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@tripwire/ui/item";
import { SkeletonSwap, SkeletonText } from "@tripwire/ui/skeleton";
import { Status, type StatusValue } from "@tripwire/ui/status";
import {
	Step,
	StepIndicator,
	StepSeparator,
	Steps,
	StepText,
	StepTitle,
	StepTrigger,
} from "@tripwire/ui/steps";
import { type ReactNode, useState } from "react";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import {
	type AccountDeletionView,
	deleteMyAccount,
} from "#/lib/account.functions";
import {
	accountDeletionQueryOptions,
	accountQueryKeys,
} from "#/lib/account.query";
import {
	type DeletionStep,
	deletionSteps,
	installationSettingsUrl,
} from "#/lib/account-deletion";
import { disarmRepoById } from "#/lib/arm.functions";
import { authClient } from "#/lib/auth-client";
import { orgQueryKeys } from "#/lib/org.query";

type RepoState = "on" | "turning-off" | "off" | "failed";

const REPO_STATUS = {
	on: { status: "idle", label: "On" },
	"turning-off": { status: "running", label: "Turning off" },
	off: { status: "ok", label: "Off" },
	failed: { status: "fail", label: "Could not turn off" },
} satisfies Record<RepoState, { status: StatusValue; label: string }>;

const STEP_LABEL = {
	repos: "Turn off",
	checks: "Check",
	confirm: "Confirm",
} satisfies Record<Exclude<DeletionStep, "blocked">, string>;

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

async function signOutToLogin() {
	await authClient.signOut().catch(() => undefined);
	window.location.assign("/login");
}

interface DeletionDialogStateProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	finalFocus: () => HTMLElement | null;
}

export function DeleteAccountDialog({
	finalFocus,
	open,
	onOpenChange,
	onLeave,
}: DeletionDialogStateProps & {
	onLeave: () => void;
}) {
	const { data: plan, isFetching } = useQuery({
		...accountDeletionQueryOptions(),
		enabled: open,
	});
	const [stepIndex, setStepIndex] = useState(0);
	const steps = plan
		? deletionSteps({
				soleAdminOrgs: plan.soleAdminOrgs.length,
				onRepos: plan.onRepos.length,
			})
		: [];
	const [frozenSteps, setFrozenSteps] = useState<DeletionStep[] | null>(null);
	const [previousOpen, setPreviousOpen] = useState(open);
	if (previousOpen !== open) {
		setPreviousOpen(open);
		if (open) {
			setStepIndex(0);
			setFrozenSteps(null);
		}
	}
	const flow = frozenSteps ?? steps;
	const step = flow[Math.min(stepIndex, flow.length - 1)];

	const next = () => {
		setFrozenSteps(flow);
		setStepIndex((index) => Math.min(index + 1, flow.length - 1));
	};
	const leave = () => {
		onOpenChange(false);
		onLeave();
	};
	const dialog = { finalFocus, open, onOpenChange };
	if (plan && step === "confirm") {
		return (
			<ConfirmStep
				onBack={() => setStepIndex((index) => Math.max(index - 1, 0))}
				{...dialog}
				plan={plan}
				progress={<DeletionProgress flow={flow} stepIndex={stepIndex} />}
			/>
		);
	}

	if (!plan || !step || (isFetching && !frozenSteps)) {
		return <DeletionSkeleton {...dialog} />;
	}
	return (
		<DeletionStepView
			flow={flow}
			onLeave={leave}
			onNext={next}
			{...dialog}
			plan={plan}
			step={step}
			stepIndex={stepIndex}
		/>
	);
}

function DeletionSkeleton(dialog: DeletionDialogStateProps) {
	return (
		<Dialog {...dialog} title="Delete account">
			<SkeletonSwap
				fallback={<SkeletonText lines={3} type="body-sm" />}
				label="Checking your account"
				loading
			>
				<span />
			</SkeletonSwap>
		</Dialog>
	);
}

function DeletionProgress({
	flow,
	stepIndex,
}: {
	flow: DeletionStep[];
	stepIndex: number;
}) {
	const shown = flow.filter(
		(entry): entry is Exclude<DeletionStep, "blocked"> => entry !== "blocked",
	);
	return (
		<Steps
			aria-label="Delete account steps"
			data-layout-role="account-deletion-progress"
			size="small"
			value={stepIndex + 1}
		>
			{shown.map((entry, index) => (
				<Step key={entry} step={index + 1}>
					<StepTrigger>
						<StepIndicator />
						<StepText>
							<StepTitle>{STEP_LABEL[entry]}</StepTitle>
						</StepText>
					</StepTrigger>
					<StepSeparator />
				</Step>
			))}
		</Steps>
	);
}

function DeletionStepView({
	plan,
	step,
	flow,
	stepIndex,
	onNext,
	onLeave,
	...dialog
}: DeletionDialogStateProps & {
	plan: AccountDeletionView;
	step: DeletionStep;
	flow: DeletionStep[];
	stepIndex: number;
	onNext: () => void;
	onLeave: () => void;
}) {
	if (step === "blocked") {
		return <BlockedStep onLeave={onLeave} {...dialog} plan={plan} />;
	}
	const progress = <DeletionProgress flow={flow} stepIndex={stepIndex} />;
	if (step === "repos") {
		return (
			<ReposStep onNext={onNext} {...dialog} plan={plan} progress={progress} />
		);
	}
	if (step === "checks") {
		return (
			<ChecksStep onNext={onNext} {...dialog} plan={plan} progress={progress} />
		);
	}
	return null;
}

function BlockedStep({
	plan,
	onLeave,
	...dialog
}: DeletionDialogStateProps & {
	plan: AccountDeletionView;
	onLeave: () => void;
}) {
	return (
		<Dialog
			cancelLabel="Close"
			description={
				<>
					You are the only admin of{" "}
					{plan.soleAdminOrgs.length === 1 ? "this org" : "these orgs"}. Add
					another admin or delete the org first.
				</>
			}
			{...dialog}
			title="You can't delete your account yet"
		>
			<ItemGroup aria-label="Orgs you are the only admin of" variant="plain">
				{plan.soleAdminOrgs.map((org) => (
					<Item key={org.orgId}>
						<ItemMedia>
							<OrgAvatar hue={org.avatarHue} name={org.name} />
						</ItemMedia>
						<ItemContent>
							<ItemTitle>{org.name}</ItemTitle>
							<ItemDescription>
								{plural(org.members, "member", "members")}
							</ItemDescription>
						</ItemContent>
						<ItemActions>
							<Button
								href={`/${org.slug}/settings/members`}
								onNavigate={(href) => {
									onLeave();
									window.location.assign(href);
								}}
								size="small"
								variant="ghost"
							>
								Members
							</Button>
							<Button
								href={`/${org.slug}/settings/general`}
								onNavigate={(href) => {
									onLeave();
									window.location.assign(href);
								}}
								size="small"
								variant="ghost"
							>
								Delete org
							</Button>
						</ItemActions>
					</Item>
				))}
			</ItemGroup>
		</Dialog>
	);
}

function ReposStep({
	plan,
	progress,
	onNext,
	...dialog
}: DeletionDialogStateProps & {
	plan: AccountDeletionView;
	progress: ReactNode;
	onNext: () => void;
}) {
	const queryClient = useQueryClient();
	const [states, setStates] = useState<Record<string, RepoState>>({});
	const [running, setRunning] = useState(false);
	const stateOf = (id: string): RepoState => states[id] ?? "on";
	const remaining = plan.onRepos.filter((repo) => stateOf(repo.id) !== "off");
	const done = plan.onRepos.length - remaining.length;
	const failed = plan.onRepos.some((repo) => stateOf(repo.id) === "failed");

	const turnOffAll = async () => {
		setRunning(true);
		for (const repo of remaining) {
			setStates((prev) => ({ ...prev, [repo.id]: "turning-off" }));
			try {
				await disarmRepoById({
					data: { org: repo.orgSlug, repoId: repo.id },
				});
				setStates((prev) => ({ ...prev, [repo.id]: "off" }));
			} catch {
				setStates((prev) => ({ ...prev, [repo.id]: "failed" }));
			}
		}
		setRunning(false);
		await queryClient.invalidateQueries({ queryKey: orgQueryKeys.all });
	};

	return (
		<Dialog
			action={{
				disabled: remaining.length > 0 || running,
				dismissOnSuccess: false,
				label: "Continue",
				onAction: onNext,
			}}
			description={
				<>
					Nobody else can turn Tripwire off on{" "}
					{plan.onRepos.length === 1 ? "this repo" : "these repos"}.
				</>
			}
			headerLeading={progress}
			{...dialog}
			title="Turn off Tripwire"
		>
			<div className="flex flex-col composition-gap-section">
				<ItemGroup aria-label="Repos with Tripwire on" variant="plain">
					{plan.onRepos.map((repo) => {
						const state = REPO_STATUS[stateOf(repo.id)];
						return (
							<Item key={repo.id} density="compact">
								<ItemContent>
									<ItemTitle data-layout-role="account-deletion-repo">
										{repo.fullName}
									</ItemTitle>
									<ItemDescription>{repo.orgName}</ItemDescription>
								</ItemContent>
								<Status live size="small" status={state.status}>
									{state.label}
								</Status>
							</Item>
						);
					})}
				</ItemGroup>
				{remaining.length > 0 ? (
					<div>
						<Button
							onAction={turnOffAll}
							pending={running}
							pendingLabel={`Turning off ${done + 1} of ${plan.onRepos.length}`}
							size="small"
							variant="secondary"
						>
							{failed
								? "Try the rest again"
								: plan.onRepos.length === 1
									? "Turn off Tripwire on this repo"
									: "Turn off Tripwire on all of these"}
						</Button>
					</div>
				) : null}
			</div>
		</Dialog>
	);
}

function ChecksStep({
	plan,
	progress,
	onNext,
	...dialog
}: DeletionDialogStateProps & {
	plan: AccountDeletionView;
	progress: ReactNode;
	onNext: () => void;
}) {
	return (
		<Dialog
			action={{
				disabled: !plan.freshSession,
				dismissOnSuccess: false,
				label: "Continue",
				onAction: onNext,
			}}
			description="What changes when your account goes."
			headerLeading={progress}
			{...dialog}
			title="Before you go"
		>
			<ItemGroup aria-label="Checks" variant="plain">
				{plan.freshSession ? null : (
					<Item>
						<ItemContent>
							<ItemTitle>Sign in again first</ItemTitle>
							<ItemDescription>
								You signed in more than a day ago.
							</ItemDescription>
						</ItemContent>
						<ItemActions>
							<Button
								onAction={signOutToLogin}
								size="small"
								variant="secondary"
							>
								Sign in again
							</Button>
						</ItemActions>
					</Item>
				)}
				{plan.installations.map((install) => {
					const url = installationSettingsUrl(install);
					return (
						<Item key={install.installationId}>
							<ItemContent>
								<ItemTitle>
									Tripwire app on {install.accountLogin ?? "your account"}
								</ItemTitle>
								<ItemDescription>
									It stays installed until you uninstall it there.
								</ItemDescription>
							</ItemContent>
							{url ? (
								<ItemActions>
									<Button
										href={url}
										openInNewTab
										size="small"
										trailingIcon={<Icon icon={External} size={12} />}
										variant="secondary"
									>
										Uninstall on GitHub
									</Button>
								</ItemActions>
							) : null}
						</Item>
					);
				})}
				{plan.pendingReviews > 0 && plan.personalOrg ? (
					<Item>
						<ItemContent>
							<ItemTitle>
								{plural(plan.pendingReviews, "human review", "human reviews")}{" "}
								waiting
							</ItemTitle>
							<ItemDescription>
								They are in {plan.personalOrg.name}. Nobody can decide them
								after this.
							</ItemDescription>
						</ItemContent>
					</Item>
				) : null}
				{plan.agents > 0 ? (
					<Item>
						<ItemContent>
							<ItemTitle>
								{plural(plan.agents, "agent loses", "agents lose")} access
							</ItemTitle>
						</ItemContent>
					</Item>
				) : null}
				<Item>
					<ItemContent>
						<ItemTitle>
							Signed out on {plural(plan.sessions, "device", "devices")}
						</ItemTitle>
					</ItemContent>
				</Item>
			</ItemGroup>
		</Dialog>
	);
}

function ConfirmStep({
	plan,
	progress,
	onBack,
	...dialog
}: DeletionDialogStateProps & {
	plan: AccountDeletionView;
	progress: ReactNode;
	onBack: () => void;
}) {
	const queryClient = useQueryClient();
	const remove = useMutation({
		mutationFn: async () => {
			const result = await deleteMyAccount({
				data: { confirm: plan.confirmText },
			});
			if (!result.ok) {
				throw new Error(result.error);
			}
		},
		onSuccess: async () => {
			queryClient.removeQueries({ queryKey: accountQueryKeys.all });
			await signOutToLogin();
		},
	});
	return (
		<DestructiveDialog
			confirmLabel="Delete account"
			confirmText={plan.confirmText}
			description="This can't be undone."
			media={
				<>
					{progress}
					<dl className="flex flex-col composition-gap-section content-body-small">
						<div className="flex flex-col composition-gap-hairline">
							<dt className="content-label">Deleted</dt>
							<dd className="tone-content-secondary">
								Your profile, sessions, forge connections and agents
								{plan.personalOrg
									? `, and ${plan.personalOrg.name} with its rules and workflows.`
									: "."}
							</dd>
						</div>
						<div className="flex flex-col composition-gap-hairline">
							<dt className="content-label">Kept</dt>
							<dd className="tone-content-secondary">
								Runs and history in your other orgs. Your approvals and blocks
								stay there without your name.
							</dd>
						</div>
					</dl>
				</>
			}
			onConfirm={() => remove.mutateAsync()}
			{...dialog}
			pendingLabel="Deleting"
			secondaryAction={{ label: "Back", onAction: onBack }}
			title="Delete your account?"
		/>
	);
}
