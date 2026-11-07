import { createFileRoute } from "@tanstack/react-router";
import {
	SHARED_BLOCKLIST_API_PATH,
	SHARED_BLOCKLIST_REPOSITORY,
} from "@tripwire/contracts";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { MascotArt } from "#/components/mascot/mascot-art";
import { GithubMark, Icon } from "#/design-system/icon";
import { Avatar } from "#/design-system/ui/avatar";
import { Button, buttonVariants } from "#/design-system/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/design-system/ui/empty-state";
import { RelativeTime } from "#/design-system/ui/relative-time";
import {
	Body,
	PageTitle,
	SectionHeading,
	SupportingText,
} from "#/design-system/ui/typography";
import {
	blocklistSearchSchema,
	getPublicSharedBlocklist,
} from "#/lib/public-blocklist.functions";

export const Route = createFileRoute("/pilot")({
	validateSearch: blocklistSearchSchema,
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => getPublicSharedBlocklist({ data: deps }),
	head: () => ({ meta: [{ title: "Pilot | Tripwire" }] }),
	pendingComponent: () => (
		<main data-layout-role="public-blocklist">
			<Body role="status">Loading the blocklist…</Body>
		</main>
	),
	component: PublicBlocklist,
});

const SUGGEST_ACCOUNT_URL = `${SHARED_BLOCKLIST_REPOSITORY}/issues/new?${new URLSearchParams(
	{
		title: "Suggest an account",
		body: "GitHub username or profile URL:\n\nWhat happened? Include public links if available. Keep private evidence out of this issue.",
	},
)}`;
const APPEAL_URL = `${SHARED_BLOCKLIST_REPOSITORY}/issues/new?${new URLSearchParams(
	{
		title: "Appeal a block",
		body: "GitHub username or profile URL:\n\nWhy should this listing be changed or removed? Keep private details out of this issue.",
	},
)}`;

function PublicBlocklist() {
	const { snapshot, stars } = Route.useLoaderData();
	const showSearch = Boolean(snapshot?.total);
	const starCount =
		stars === null
			? null
			: `${stars.toLocaleString("en-US")} ${stars === 1 ? "star" : "stars"}`;
	const { q = "" } = Route.useSearch();

	return (
		<main data-layout-role="public-blocklist">
			<nav aria-label="Tripwire" data-layout-role="public-blocklist-nav">
				<a
					href="https://tripwire.sh"
					data-layout-role="public-blocklist-brand"
					aria-label="Tripwire home"
				>
					<TripwireLogo size={22} />
					<span>Tripwire</span>
				</a>
				<div data-layout-role="public-blocklist-actions">
					<a
						data-slot="button"
						className={buttonVariants({ variant: "secondary" })}
						href={APPEAL_URL}
					>
						Appeal a block
					</a>
					<a
						data-slot="button"
						className={buttonVariants({ variant: "secondary" })}
						href={SHARED_BLOCKLIST_REPOSITORY}
					>
						<Icon icon={GithubMark} />
						View on GitHub
						{starCount ? (
							<SupportingText as="span">{starCount}</SupportingText>
						) : null}
					</a>
				</div>
			</nav>
			<header data-layout-role="public-blocklist-stack">
				<PageTitle>Pilot</PageTitle>
				<SupportingText>
					A public list of GitHub accounts reported for spam and reviewed by
					maintainers.
				</SupportingText>
			</header>
			<section className="shell" aria-labelledby="blocklist-accounts">
				<div className="panel" data-layout-role="public-blocklist-directory">
					{showSearch ? (
						<header data-layout-role="public-blocklist-toolbar">
							<div data-layout-role="public-blocklist-stack">
								<SectionHeading id="blocklist-accounts">
									Listed accounts
								</SectionHeading>
								{snapshot ? (
									<SupportingText>
										{q
											? `${snapshot.matches} of ${snapshot.total} accounts`
											: `${snapshot.total} ${snapshot.total === 1 ? "account" : "accounts"}`}
									</SupportingText>
								) : null}
							</div>
							<form
								action="/pilot"
								method="get"
								data-layout-role="public-blocklist-search"
							>
								<input
									key={q}
									className="field"
									aria-label="GitHub username"
									placeholder="GitHub username"
									name="q"
									type="search"
									maxLength={100}
									defaultValue={q}
								/>
								<Button type="submit" variant="secondary">
									Search
								</Button>
							</form>
						</header>
					) : null}
					{snapshot?.entries.length ? (
						<table data-layout-role="public-blocklist-table">
							<thead>
								<tr>
									<th scope="col">GitHub account</th>
									<th scope="col">Reason</th>
									<th scope="col">Expires (UTC)</th>
								</tr>
							</thead>
							<tbody>
								{snapshot.entries.map((entry) => (
									<tr key={entry.accountId}>
										<td>
											<a
												data-layout-role="public-blocklist-account"
												href={`https://github.com/${encodeURIComponent(entry.login)}`}
											>
												<Avatar
													decorative
													name={entry.login}
													size="sm"
													src={`https://avatars.githubusercontent.com/u/${entry.accountId}?s=40&v=4`}
												/>
												<span>@{entry.login}</span>
											</a>
										</td>
										<td>{entry.reason}</td>
										<td>
											{entry.expiresAt ? (
												<time dateTime={entry.expiresAt}>
													{entry.expiresAt.slice(0, 10)}
												</time>
											) : (
												"No expiry"
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					) : (
						<Empty
							art={
								<MascotArt mood={snapshot ? "activity-empty" : "route-error"} />
							}
							reason={!snapshot ? "error" : showSearch ? "no-results" : "empty"}
							variant="plain"
						>
							<EmptyHeader>
								<EmptyTitle id={showSearch ? undefined : "blocklist-accounts"}>
									{!snapshot
										? "Blocklist unavailable"
										: showSearch
											? "No matching accounts"
											: "No accounts listed"}
								</EmptyTitle>
								<EmptyDescription>
									{!snapshot
										? "Try again in a few minutes."
										: showSearch
											? "Try a different GitHub username."
											: "Know an account sending spam? Suggest it for review."}
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								{showSearch ? (
									<a
										data-slot="button"
										className={buttonVariants({ variant: "secondary" })}
										href="/pilot"
									>
										Clear search
									</a>
								) : (
									<a
										data-slot="button"
										className={buttonVariants()}
										href={SUGGEST_ACCOUNT_URL}
									>
										Suggest an account
									</a>
								)}
							</EmptyContent>
						</Empty>
					)}
				</div>
				{snapshot ? (
					<div className="shell-foot" data-layout-role="public-blocklist-meta">
						<SupportingText as="span">
							Updated <RelativeTime date={snapshot.publishedAt} format="long" />
						</SupportingText>
						{snapshot.pageCount > 1 ? (
							<nav
								aria-label="Result pages"
								data-layout-role="public-blocklist-search"
							>
								{snapshot.page > 1 ? (
									<a
										href={`/pilot?${new URLSearchParams({ q, page: String(snapshot.page - 1) })}`}
									>
										Previous
									</a>
								) : null}
								<SupportingText as="span">
									Page {snapshot.page} of {snapshot.pageCount}
								</SupportingText>
								{snapshot.page < snapshot.pageCount ? (
									<a
										href={`/pilot?${new URLSearchParams({ q, page: String(snapshot.page + 1) })}`}
									>
										Next
									</a>
								) : null}
							</nav>
						) : null}
					</div>
				) : null}
			</section>
			<footer data-layout-role="public-blocklist-footer">
				{showSearch ? (
					<a href={SUGGEST_ACCOUNT_URL}>Suggest an account</a>
				) : null}
				<a href={SHARED_BLOCKLIST_API_PATH}>JSON API</a>
				<a href={`${SHARED_BLOCKLIST_API_PATH}?format=txt`}>Raw usernames</a>
			</footer>
			<aside
				data-layout-role="public-blocklist-callout"
				aria-labelledby="blocklist-tripwire"
			>
				<SectionHeading id="blocklist-tripwire">
					Want to block these accounts automatically?
				</SectionHeading>
				<SupportingText>
					The Tripwire pilot sends matches to Human review. Automatic blocking
					is planned.
				</SupportingText>
				<a
					data-slot="button"
					className={buttonVariants({ variant: "secondary" })}
					href="https://tripwire.sh"
				>
					Visit Tripwire
				</a>
			</aside>
		</main>
	);
}
