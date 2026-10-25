import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { External, Icon } from "#/components/glaze/icon";
import { Button, buttonVariants } from "#/components/glaze/ui/button";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogConfirmField,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { SkeletonSwap, SkeletonText } from "#/components/glaze/ui/skeleton";
import { Status, type StatusValue } from "#/components/glaze/ui/status";
import {
	Step,
	StepIndicator,
	StepSeparator,
	Steps,
	StepText,
	StepTitle,
	StepTrigger,
} from "#/components/glaze/ui/steps";
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

export function DeleteAccountDialog({
	open,
	onOpenChange,
	onLeave,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
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
	const flow = frozenSteps ?? steps;
	const step = flow[Math.min(stepIndex, flow.length - 1)];

	const setOpen = (next: boolean) => {
		onOpenChange(next);
		if (!next) {
			setStepIndex(0);
			setFrozenSteps(null);
		}
	};
	const next = () => {
		setFrozenSteps(flow);
		setStepIndex((index) => Math.min(index + 1, flow.length - 1));
	};
	const leave = () => {
		setOpen(false);
		onLeave();
	};

	return (
		<Dialog
			confirmText={step === "confirm" ? plan?.confirmText : undefined}
			onOpenChange={setOpen}
			open={open}
			role="alertdialog"
		>
			<DialogContent size="sm">
				<SkeletonSwap
					fallback={<DeletionSkeleton />}
					label="Checking your account"
					loading={!plan || (isFetching && !frozenSteps)}
				>
					{plan && step ? (
						<DeletionStepView
							flow={flow}
							onBack={() => setStepIndex((index) => Math.max(index - 1, 0))}
							onLeave={leave}
							onNext={next}
							plan={plan}
							step={step}
							stepIndex={stepIndex}
						/>
					) : null}
				</SkeletonSwap>
			</DialogContent>
		</Dialog>
	);
}

function DeletionSkeleton() {
	return (
		<>
			<DialogHeader>
				<DialogTitle>Delete account</DialogTitle>
			</DialogHeader>
			<DialogBody>
				<SkeletonText lines={3} type="body-sm" />
			</DialogBody>
			<DialogFooter>
				<DialogClose>Cancel</DialogClose>
			</DialogFooter>
		</>
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
			className="pb-2"
			size="sm"
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
	onBack,
	onLeave,
}: {
	plan: AccountDeletionView;
	step: DeletionStep;
	flow: DeletionStep[];
	stepIndex: number;
	onNext: () => void;
	onBack: () => void;
	onLeave: () => void;
}) {
	if (step === "blocked") {
		return <BlockedStep onLeave={onLeave} plan={plan} />;
	}
	const progress = <DeletionProgress flow={flow} stepIndex={stepIndex} />;
	if (step === "repos") {
		return <ReposStep onNext={onNext} plan={plan} progress={progress} />;
	}
	if (step === "checks") {
		return <ChecksStep onNext={onNext} plan={plan} progress={progress} />;
	}
	return <ConfirmStep onBack={onBack} plan={plan} progress={progress} />;
}

function BlockedStep({
	plan,
	onLeave,
}: {
	plan: AccountDeletionView;
	onLeave: () => void;
}) {
	return (
		<>
			<DialogHeader>
				<DialogTitle>You can't delete your account yet</DialogTitle>
				<DialogDescription>
					You are the only admin of{" "}
					{plan.soleAdminOrgs.length === 1 ? "this org" : "these orgs"}. Add
					another admin or delete the org first.
				</DialogDescription>
			</DialogHeader>
			<DialogBody>
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
								<Link
									className={buttonVariants({ variant: "ghost", size: "sm" })}
									onClick={onLeave}
									params={{ org: org.slug }}
									to="/$org/settings/members"
								>
									Members
								</Link>
								<Link
									className={buttonVariants({ variant: "ghost", size: "sm" })}
									onClick={onLeave}
									params={{ org: org.slug }}
									to="/$org/settings/general"
								>
									Delete org
								</Link>
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			</DialogBody>
			<DialogFooter>
				<DialogClose>Close</DialogClose>
			</DialogFooter>
		</>
	);
}

function ReposStep({
	plan,
	progress,
	onNext,
}: {
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
		<>
			<DialogHeader>
				{progress}
				<DialogTitle>Turn off Tripwire</DialogTitle>
				<DialogDescription>
					Nobody else can turn Tripwire off on{" "}
					{plan.onRepos.length === 1 ? "this repo" : "these repos"}.
				</DialogDescription>
			</DialogHeader>
			<DialogBody>
				<div className="flex flex-col gap-3">
					<ItemGroup aria-label="Repos with Tripwire on" variant="plain">
						{plan.onRepos.map((repo) => {
							const state = REPO_STATUS[stateOf(repo.id)];
							return (
								<Item key={repo.id} size="sm">
									<ItemContent>
										<ItemTitle className="type-code-sm">
											{repo.fullName}
										</ItemTitle>
										<ItemDescription>{repo.orgName}</ItemDescription>
									</ItemContent>
									<Status live size="sm" status={state.status}>
										{state.label}
									</Status>
								</Item>
							);
						})}
					</ItemGroup>
					{remaining.length > 0 ? (
						<div>
							<Button
								onClick={turnOffAll}
								pending={running}
								pendingLabel={`Turning off ${done + 1} of ${plan.onRepos.length}`}
								size="sm"
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
			</DialogBody>
			<DialogFooter>
				<DialogClose>Cancel</DialogClose>
				<DialogAction
					close={false}
					disabled={remaining.length > 0 || running}
					onClick={onNext}
				>
					Continue
				</DialogAction>
			</DialogFooter>
		</>
	);
}

function ChecksStep({
	plan,
	progress,
	onNext,
}: {
	plan: AccountDeletionView;
	progress: ReactNode;
	onNext: () => void;
}) {
	return (
		<>
			<DialogHeader>
				{progress}
				<DialogTitle>Before you go</DialogTitle>
				<DialogDescription>
					What changes when your account goes.
				</DialogDescription>
			</DialogHeader>
			<DialogBody>
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
								<Button onClick={signOutToLogin} size="sm" variant="secondary">
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
										<a
											className={buttonVariants({
												variant: "secondary",
												size: "sm",
											})}
											href={url}
											rel="noreferrer"
											target="_blank"
										>
											Uninstall on GitHub
											<Icon icon={External} size={12} />
										</a>
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
			</DialogBody>
			<DialogFooter>
				<DialogClose>Cancel</DialogClose>
				<DialogAction
					close={false}
					disabled={!plan.freshSession}
					onClick={onNext}
				>
					Continue
				</DialogAction>
			</DialogFooter>
		</>
	);
}

function ConfirmStep({
	plan,
	progress,
	onBack,
}: {
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
		<>
			<DialogHeader>
				{progress}
				<DialogTitle>Delete your account?</DialogTitle>
				<DialogDescription>This can't be undone.</DialogDescription>
			</DialogHeader>
			<DialogBody>
				<dl className="flex flex-col gap-3 type-body-sm">
					<div className="flex flex-col gap-0.5">
						<dt className="type-label">Deleted</dt>
						<dd className="text-text-2">
							Your profile, sessions, forge connections and agents
							{plan.personalOrg
								? `, and ${plan.personalOrg.name} with its rules and workflows.`
								: "."}
						</dd>
					</div>
					<div className="flex flex-col gap-0.5">
						<dt className="type-label">Kept</dt>
						<dd className="text-text-2">
							Runs and history in your other orgs. Your approvals and blocks
							stay there without your name.
						</dd>
					</div>
				</dl>
				<DialogConfirmField />
			</DialogBody>
			<DialogFooter>
				<Button onClick={onBack} size="sm" variant="ghost">
					Back
				</Button>
				<DialogAction
					onAction={() => remove.mutateAsync()}
					pendingLabel="Deleting"
					variant="destructive"
				>
					Delete account
				</DialogAction>
			</DialogFooter>
		</>
	);
}
