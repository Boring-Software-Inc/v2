import { useQuery } from "@tanstack/react-query";
import { Add, Check, Icon, Search } from "@tripwire/ui/icon";
import { PageTitle, SupportingText } from "@tripwire/ui/typography";
import { ForgeMark } from "#/components/common/forge-marks";
import { ModerationPageFrame } from "#/components/moderation/moderation-page-frame";
import { ModerationQueueEmpty } from "#/components/moderation/moderation-queue";
import { PreviewApp } from "#/components/onboarding/preview/preview-app";
import { onboardingReposQueryOptions } from "#/lib/onboarding-flow.query";

/**
 * Human review for the first repo being watched, with the repo switcher open
 * so the user sees the repos they are picking land in the workspace.
 */
export function ModerationPreview({
	org,
	selected,
}: {
	org: string;
	selected: readonly string[];
}) {
	const repos = useQuery(onboardingReposQueryOptions(org)).data ?? [];
	const current =
		repos.find((repo) => repo.id === selected[0]) ?? repos[0] ?? null;
	return (
		<PreviewApp
			active="moderation"
			forge={current?.forge}
			overlay={
				repos.length > 0 ? (
					<div data-layout-role="onboarding-switcher-callout">
						<div data-part="search">
							<Icon icon={Search} />
							<span>Find a repo</span>
						</div>
						<div data-part="rows">
							{repos.slice(0, 6).map((repo) => (
								<div
									data-part="row"
									data-watched={selected.includes(repo.id) ? "true" : "false"}
									key={repo.id}
								>
									<ForgeMark className="size-3.5 shrink-0" forge={repo.forge} />
									<span data-part="name">{repo.fullName}</span>
									{selected.includes(repo.id) ? (
										<Icon icon={Check} size={14} />
									) : (
										<span data-part="off">Off</span>
									)}
								</div>
							))}
						</div>
						<div data-part="footer">
							<Icon icon={Add} />
							<span>Connect repos</span>
						</div>
					</div>
				) : null
			}
			repo={current?.fullName ?? null}
			url={{
				host: "app.tripwire.sh",
				path: current ? `/${org}/${current.name}/moderation` : `/${org}/home`,
			}}
		>
			<ModerationPageFrame>
				<header data-layout-role="moderation-header">
					<PageTitle>Human review</PageTitle>
					<SupportingText>
						Approve to continue the workflow, or block.
					</SupportingText>
				</header>
				<div data-layout-role="moderation-queue">
					<ModerationQueueEmpty org={org} repo={current?.name ?? ""} />
				</div>
			</ModerationPageFrame>
		</PreviewApp>
	);
}
