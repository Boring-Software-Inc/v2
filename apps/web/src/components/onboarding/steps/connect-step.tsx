import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@tripwire/ui/badge";
import { Button } from "@tripwire/ui/button";
import { Checkbox } from "@tripwire/ui/checkbox";
import { Input } from "@tripwire/ui/field";
import { External, Icon, Pending, Search } from "@tripwire/ui/icon";
import { Skeleton } from "@tripwire/ui/skeleton";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import {
	type ConnectPhase,
	type OnboardingDraft,
	useOnboardingDraft,
} from "#/components/onboarding/onboarding-draft";
import { OnboardingStepHeader } from "#/components/onboarding/onboarding-frame";
import type { StepViewProps } from "#/components/onboarding/onboarding-steps";
import {
	ConnectingPreview,
	GithubInstallPreview,
} from "#/components/onboarding/preview/connect-previews";
import { HomePreview } from "#/components/onboarding/preview/home-preview";
import { ModerationPreview } from "#/components/onboarding/preview/moderation-preview";
import { armRepoById } from "#/lib/arm.functions";
import { orgInstallUrlQueryOptions } from "#/lib/onboarding.query";
import {
	onboardingFlowKeys,
	onboardingReposQueryOptions,
} from "#/lib/onboarding-flow.query";
import { orgHomeQueryOptions } from "#/lib/org.query";

const copy = ONBOARDING_COPY.connect;
const POLL_MS = 2_000;
const WAITING_LONG_MS = 45_000;

type InstallForge = OnboardingDraft["forge"];

const FORGES: readonly InstallForge[] = ["github", "gitcafe"];

/** The workspace this onboarding sets up: the team one, else the personal one. */
function onboardingOrg(flow: StepViewProps["flow"]): string {
	return flow.state.orgSlug ?? flow.state.personalOrgSlug ?? "";
}

function useConnectPhase(org: string, opened: boolean) {
	const [draft] = useOnboardingDraft();
	const waiting =
		draft.connectPhase === "waiting" || draft.connectPhase === "syncing";
	const home = useQuery({
		...orgHomeQueryOptions(org),
		enabled: org.length > 0,
		refetchInterval: waiting || opened ? POLL_MS : false,
	});
	if (!home.data) {
		return { phase: null, refetching: home.isFetching };
	}
	const phase: ConnectPhase = !home.data.hasInstallation
		? opened
			? "waiting"
			: "forge"
		: home.data.repos.length === 0
			? "syncing"
			: "repos";
	return { phase, refetching: home.isFetching };
}

/**
 * Step 4: install the forge app, wait for it in the other tab, then pick the
 * repos Tripwire watches. Watching a repo turns its gate on.
 */
export function ConnectStep({ flow }: StepViewProps) {
	const [draft, update] = useOnboardingDraft();
	const org = onboardingOrg(flow);
	const [opened, setOpened] = useState(false);
	const { phase } = useConnectPhase(org, opened);

	// Before paint, so the preview never shows the page for a phase already
	// past.
	useLayoutEffect(() => {
		if (phase) {
			update({ connectPhase: phase });
		}
	}, [phase, update]);

	return (
		<>
			<OnboardingStepHeader
				current={flow.step}
				steps={flow.steps}
				sub={
					phase === "repos"
						? copy.installedSub(copy.forges[draft.forge].app)
						: copy.sub
				}
				title={copy.title}
			/>
			<fieldset data-layout-role="onboarding-forges">
				<legend className="sr-only">{copy.title}</legend>
				{FORGES.map((forge) => (
					<label data-layout-role="onboarding-forge" key={forge}>
						<input
							checked={draft.forge === forge}
							name="forge"
							onChange={() => update({ forge })}
							type="radio"
							value={forge}
						/>
						<span data-part="mark">
							<ForgeMark className="size-5" forge={forge} />
						</span>
						<span data-part="text">
							<span data-part="name">{copy.forges[forge].name}</span>
							<span data-part="action">{copy.forges[forge].action}</span>
						</span>
					</label>
				))}
			</fieldset>
			{phase === null ? (
				<Skeleton />
			) : phase === "forge" ? (
				<InstallAction
					forge={draft.forge}
					onOpened={() => setOpened(true)}
					org={org}
				/>
			) : phase === "waiting" ? (
				<WaitingCard forge={draft.forge} org={org} />
			) : phase === "syncing" ? (
				<SyncingCard org={org} />
			) : (
				<RepoPicker flow={flow} org={org} />
			)}
		</>
	);
}

function InstallAction({
	forge,
	org,
	onOpened,
}: {
	forge: InstallForge;
	org: string;
	onOpened: () => void;
}) {
	const install = useQuery(orgInstallUrlQueryOptions(org, forge));
	if (install.data && install.data.status !== "ready") {
		return (
			<p data-layout-role="onboarding-error" role="alert">
				{copy.unavailable(copy.forges[forge].app)}
			</p>
		);
	}
	const url = install.data?.status === "ready" ? install.data.url : null;
	return (
		<Button
			disabled={url === null}
			onAction={() => {
				if (url) {
					window.open(url, "_blank", "noopener");
					onOpened();
				}
			}}
			pending={install.isPending}
			size="large"
			variant="primary"
		>
			{copy.installOn(copy.forges[forge].name)}
		</Button>
	);
}

function WaitingCard({ forge, org }: { forge: InstallForge; org: string }) {
	const install = useQuery(orgInstallUrlQueryOptions(org, forge));
	const [long, setLong] = useState(false);
	useEffect(() => {
		const timer = window.setTimeout(() => setLong(true), WAITING_LONG_MS);
		return () => window.clearTimeout(timer);
	}, []);
	const url = install.data?.status === "ready" ? install.data.url : null;
	return (
		<div data-layout-role="onboarding-card">
			<span data-part="spinner">
				<Icon icon={Pending} motion="spin" size={16} />
			</span>
			<output data-part="text">
				<span data-part="title">
					{copy.waitingTitle(copy.forges[forge].name)}
				</span>
				<span data-part="body">
					{long ? copy.waitingLong(copy.forges[forge].name) : copy.waitingBody}
				</span>
			</output>
			{url ? (
				<Button
					href={url}
					leadingIcon={<Icon icon={External} />}
					openInNewTab
					size="small"
					variant="secondary"
				>
					{copy.openForge(copy.forges[forge].name)}
				</Button>
			) : null}
		</div>
	);
}

function SyncingCard({ org }: { org: string }) {
	return (
		<section aria-label={copy.reposLabel} data-layout-role="onboarding-repos">
			<span data-layout-role="onboarding-field-legend">
				<span>{copy.reposLabel}</span>
			</span>
			<div data-layout-role="onboarding-card">
				<span data-part="spinner">
					<Icon icon={Pending} motion="spin" size={16} />
				</span>
				<output data-part="text">
					<span data-part="title">{copy.readingTitle}</span>
					<span data-part="body">{copy.readingBody(org)}</span>
				</output>
			</div>
		</section>
	);
}

function RepoPicker({
	flow,
	org,
}: {
	flow: StepViewProps["flow"];
	org: string;
}) {
	const queryClient = useQueryClient();
	const [draft, update] = useOnboardingDraft();
	const [query, setQuery] = useState("");
	const repos = useQuery(onboardingReposQueryOptions(org));
	const visible = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return (repos.data ?? []).filter((repo) =>
			repo.fullName.toLowerCase().includes(needle),
		);
	}, [query, repos.data]);
	const watch = useMutation({
		mutationFn: async (repoIds: string[]) => {
			for (const repoId of repoIds) {
				await armRepoById({ data: { org, repoId } });
			}
		},
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: onboardingFlowKeys.repos(org),
			}),
		onSuccess: (_, repoIds) => flow.advance({ org, repoId: repoIds[0] }),
	});
	const toggle = (repoId: string, checked: boolean) =>
		update({
			repoIds: checked
				? [...draft.repoIds, repoId]
				: draft.repoIds.filter((id) => id !== repoId),
		});
	const total = repos.data?.length ?? 0;

	return (
		<section aria-label={copy.reposLabel} data-layout-role="onboarding-repos">
			<span data-layout-role="onboarding-field-legend">
				<span>{copy.reposLabel}</span>
				<span data-part="hint">
					{copy.reposCount(draft.repoIds.length, total)}
				</span>
			</span>
			<div data-layout-role="onboarding-list">
				<div data-part="search">
					<Input
						ariaLabel={copy.findRepo}
						leadingIcon={<Icon icon={Search} />}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={copy.findRepo}
						value={query}
					/>
				</div>
				{repos.isPending ? (
					<Skeleton />
				) : total === 0 ? (
					<div data-part="empty">
						<span data-part="title">{copy.reposEmptyTitle}</span>
						<span data-part="body">
							{copy.reposEmptyBody(copy.forges[draft.forge].app)}
						</span>
					</div>
				) : visible.length === 0 ? (
					<div data-part="empty">
						<span data-part="body">{copy.reposSearchEmpty(query.trim())}</span>
					</div>
				) : (
					visible.map((repo) => (
						<div data-part="row" key={repo.id}>
							<Checkbox
								checked={draft.repoIds.includes(repo.id)}
								label={repo.fullName}
								onCheckedChange={(checked) => toggle(repo.id, checked === true)}
							/>
							{repo.private ? (
								<Badge size="small" variant="outline">
									{copy.privateTag}
								</Badge>
							) : null}
						</div>
					))
				)}
			</div>
			{watch.isError ? (
				<p data-layout-role="onboarding-error" role="alert">
					{ONBOARDING_COPY.saveFailed}
				</p>
			) : null}
			<Button
				disabled={draft.repoIds.length === 0}
				onAction={() => watch.mutate(draft.repoIds)}
				pending={watch.isPending}
				size="large"
				variant="primary"
			>
				{copy.watch(draft.repoIds.length)}
			</Button>
		</section>
	);
}

const PHASE_PREVIEW = {
	forge: "home",
	waiting: "github-install",
	syncing: "connecting",
	repos: "moderation",
} satisfies Record<ConnectPhase, string>;

export function connectPreviewKey({ draft }: { draft: OnboardingDraft }) {
	return PHASE_PREVIEW[draft.connectPhase];
}

export function ConnectPreview({ flow }: StepViewProps) {
	const [draft] = useOnboardingDraft();
	const org = onboardingOrg(flow);
	switch (draft.connectPhase) {
		case "waiting":
			return <GithubInstallPreview forge={draft.forge} org={org} />;
		case "syncing":
			return <ConnectingPreview />;
		case "repos":
			return <ModerationPreview org={org} selected={draft.repoIds} />;
		default:
			return <HomePreview org={org} />;
	}
}
