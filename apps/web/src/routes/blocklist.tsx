import { createFileRoute } from "@tanstack/react-router";
import {
	SHARED_BLOCKLIST_API_PATH,
	SHARED_BLOCKLIST_REPOSITORY,
} from "@tripwire/contracts";
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
	component: PublicBlocklist,
});

function PublicBlocklist() {
	const snapshot = Route.useLoaderData();
	const { q = "" } = Route.useSearch();

	return (
		<main data-layout-role="public-blocklist">
			<header data-layout-role="public-blocklist-stack">
				<SupportingText>Tripwire</SupportingText>
				<PageTitle>Shared spam blocklist</PageTitle>
				<Body>
					Browse the GitHub accounts on Tripwire’s reviewed spam list.
					Repositories can opt in to send matching pull requests to a
					maintainer.
				</Body>
				<a href={`${SHARED_BLOCKLIST_REPOSITORY}/issues/new`}>
					Suggest an addition or correction on GitHub
				</a>
			</header>
			<form
				action="/blocklist"
				method="get"
				data-layout-role="public-blocklist-stack"
			>
				<label htmlFor="blocklist-search">
					Search by GitHub username or account ID
				</label>
				<div data-layout-role="public-blocklist-search">
					<input
						id="blocklist-search"
						className="field"
						name="q"
						type="search"
						maxLength={100}
						defaultValue={q}
					/>
					<Button type="submit" variant="secondary">
						Search
					</Button>
				</div>
			</form>
			<section
				aria-label="Published accounts"
				data-layout-role="public-blocklist-stack"
			>
				<SectionHeading>Published accounts</SectionHeading>
				{snapshot ? (
					<>
						<SupportingText>
							{snapshot.total} {snapshot.total === 1 ? "account" : "accounts"} ·
							Snapshot {snapshot.revision} ·{" "}
							<time dateTime={snapshot.publishedAt}>
								{snapshot.publishedAt.slice(0, 10)}
							</time>
						</SupportingText>
						{snapshot.entries.length === 0 ? (
							<Body>
								{q
									? "No accounts match your search."
									: "The current snapshot is empty."}
							</Body>
						) : (
							<ul data-layout-role="public-blocklist-stack">
								{snapshot.entries.map((entry) => (
									<li
										key={entry.accountId}
										data-layout-role="public-blocklist-entry"
									>
										<a
											href={`https://github.com/${encodeURIComponent(entry.login)}`}
										>
											@{entry.login}
										</a>
										<Body>{entry.reason}</Body>
										<SupportingText>
											Account {entry.accountId} · Expires{" "}
											<time dateTime={entry.expiresAt}>
												{entry.expiresAt.slice(0, 10)}
											</time>
										</SupportingText>
									</li>
								))}
							</ul>
						)}
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
					</>
				) : (
					<Body>
						The current snapshot is unavailable. Check the source on GitHub.
					</Body>
				)}
			</section>
			<footer data-layout-role="public-blocklist-search">
				<a href={SHARED_BLOCKLIST_API_PATH}>JSON API</a>
				<a href={SHARED_BLOCKLIST_REPOSITORY}>GitHub source</a>
			</footer>
		</main>
	);
}
