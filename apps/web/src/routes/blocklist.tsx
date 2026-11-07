import { createFileRoute } from "@tanstack/react-router";
import {
	SHARED_BLOCKLIST_API_PATH,
	SHARED_BLOCKLIST_REPOSITORY,
} from "@tripwire/contracts";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Button } from "#/design-system/ui/button";
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

export const Route = createFileRoute("/blocklist")({
	validateSearch: blocklistSearchSchema,
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => getPublicSharedBlocklist({ data: deps }),
	head: () => ({ meta: [{ title: "Shared spam blocklist | Tripwire" }] }),
	pendingComponent: () => (
		<main data-layout-role="public-blocklist">
			<Body role="status">Loading the blocklist…</Body>
		</main>
	),
	component: PublicBlocklist,
});

function PublicBlocklist() {
	const snapshot = Route.useLoaderData();
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
				<a href={SHARED_BLOCKLIST_REPOSITORY}>View on GitHub</a>
			</nav>
			<header data-layout-role="public-blocklist-intro">
				<PageTitle>Shared spam blocklist</PageTitle>
				<Body>
					A public list of GitHub accounts flagged for spam. Repositories that
					turn it on send matching pull requests to a maintainer for review.
				</Body>
			</header>
			<section className="shell" aria-labelledby="blocklist-accounts">
				<div className="panel" data-layout-role="public-blocklist-directory">
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
							action="/blocklist"
							method="get"
							data-layout-role="public-blocklist-search"
						>
							<input
								key={q}
								className="field"
								aria-label="GitHub username or account ID"
								placeholder="Username or account ID"
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
												href={`https://github.com/${encodeURIComponent(entry.login)}`}
											>
												@{entry.login}
											</a>
											<SupportingText>ID {entry.accountId}</SupportingText>
										</td>
										<td>{entry.reason}</td>
										<td>
											<time dateTime={entry.expiresAt}>
												{entry.expiresAt.slice(0, 10)}
											</time>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					) : (
						<div data-layout-role="public-blocklist-empty">
							<SectionHeading>
								{!snapshot
									? "Blocklist unavailable"
									: q
										? "No matching accounts"
										: "No accounts listed"}
							</SectionHeading>
							<Body>
								{!snapshot
									? "Try again in a few minutes or view the source on GitHub."
									: q
										? "Try a different username or numeric account ID."
										: "Accounts appear here after a maintainer publishes an entry."}
							</Body>
							{q && snapshot ? <a href="/blocklist">Clear search</a> : null}
						</div>
					)}
				</div>
				{snapshot ? (
					<div className="shell-foot" data-layout-role="public-blocklist-meta">
						<SupportingText as="span">
							Updated{" "}
							<time dateTime={snapshot.publishedAt}>
								{snapshot.publishedAt.slice(0, 10)}
							</time>{" "}
							UTC · Revision {snapshot.revision}
						</SupportingText>
						{snapshot.pageCount > 1 ? (
							<nav
								aria-label="Result pages"
								data-layout-role="public-blocklist-search"
							>
								{snapshot.page > 1 ? (
									<a
										href={`/blocklist?${new URLSearchParams({ q, page: String(snapshot.page - 1) })}`}
									>
										Previous
									</a>
								) : null}
								<SupportingText as="span">
									Page {snapshot.page} of {snapshot.pageCount}
								</SupportingText>
								{snapshot.page < snapshot.pageCount ? (
									<a
										href={`/blocklist?${new URLSearchParams({ q, page: String(snapshot.page + 1) })}`}
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
				<a
					href={`${SHARED_BLOCKLIST_REPOSITORY}#suggest-an-addition-or-correction`}
				>
					Suggest an account
				</a>
				<a href={`${SHARED_BLOCKLIST_REPOSITORY}/issues/new`}>
					Request a correction
				</a>
				<a href={SHARED_BLOCKLIST_API_PATH}>JSON API</a>
			</footer>
		</main>
	);
}
