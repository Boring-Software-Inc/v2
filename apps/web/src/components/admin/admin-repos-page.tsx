import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "@tripwire/ui/button";
import { SegmentedControl } from "@tripwire/ui/radio-group";
import { Status } from "@tripwire/ui/status";
import {
	Table,
	TableBody,
	TableCell,
	TableEmpty,
	TableHead,
	TableHeader,
	TableLoading,
	TableRow,
} from "@tripwire/ui/table";
import { CodeText } from "@tripwire/ui/typography";
import { useState } from "react";
import { AdminPagination } from "#/components/admin/admin-pagination";
import { formatAdminDate } from "#/components/admin/format-admin-date";
import { FilterBar, FilterBarSearch } from "#/components/common/filter-bar";
import { ForgeMark } from "#/components/common/forge-marks";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { adminReposQueryOptions } from "#/lib/admin.query";
import { ADMIN_REPO_STATUSES, type AdminReposSearch } from "#/lib/admin-search";
import { pickValue } from "#/lib/pick-value";

type StatusFilter = AdminReposSearch["status"];

const STATUS_FILTERS = [
	{ key: "all", label: "All" },
	{ key: "protected", label: "Protected" },
	{ key: "unprotected", label: "Not protected" },
] as const satisfies ReadonlyArray<{ key: StatusFilter; label: string }>;

const COLUMN_COUNT = 4;

export function AdminReposPage() {
	const { status } = useSearch({ from: "/admin/repos" });
	const navigate = useNavigate({ from: "/admin/repos" });
	const [search, setSearch] = useState("");
	const [offset, setOffset] = useState(0);
	const debouncedSearch = useDebouncedValue(search, 250);

	const { data, isLoading, error, refetch } = useQuery(
		adminReposQueryOptions({
			status: status === "all" ? undefined : status,
			search: debouncedSearch || undefined,
			offset,
		}),
	);

	const repos = data?.repos ?? [];
	const total = data?.total ?? 0;
	const filtered = status !== "all" || debouncedSearch !== "";

	const setStatus = (value: string) => {
		const next = pickValue(ADMIN_REPO_STATUSES, value);
		if (!next) {
			return;
		}
		setOffset(0);
		void navigate({
			search: (prev) => ({ ...prev, status: next }),
			replace: true,
			resetScroll: false,
		});
	};

	const clearFilters = () => {
		setSearch("");
		setStatus("all");
	};

	return (
		<DashboardLayout counts={{}}>
			<Page>
				<PageHeader
					description="Every connected repo and whether Tripwire is protecting it."
					title="Repos"
				/>
				<PageBody>
					<Table
						aria-busy={isLoading || undefined}
						aria-label="Repos"
						data-admin-table="repos"
						footer={
							<AdminPagination
								noun="repos"
								offset={offset}
								onOffsetChange={setOffset}
								total={total}
							/>
						}
						toolbar={
							<FilterBar aria-label="Filter repos">
								<SegmentedControl
									ariaLabel="Protection"
									onValueChange={(value) => value && setStatus(value)}
									options={STATUS_FILTERS.map((filter) => ({
										label: filter.label,
										value: filter.key,
									}))}
									value={status}
								/>
								<FilterBarSearch
									aria-label="Search repos"
									onValueChange={(value) => {
										setSearch(value);
										setOffset(0);
									}}
									placeholder="Owner or name"
									value={search}
								/>
							</FilterBar>
						}
					>
						<TableHeader>
							<TableRow>
								<TableHead>Repo</TableHead>
								<TableHead data-admin-column="repo-org">Org</TableHead>
								<TableHead>Tripwire</TableHead>
								<TableHead data-admin-column="repo-added">Added</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableLoading columns={[{}, {}, {}, {}]} />
							) : error ? (
								<TableEmpty
									action={
										<Button
											onAction={() => void refetch()}
											size="small"
											variant="secondary"
										>
											Load repos again
										</Button>
									}
									colSpan={COLUMN_COUNT}
									description={error.message}
									reason="error"
									title="Tripwire couldn't load repos"
								/>
							) : repos.length === 0 ? (
								<TableEmpty
									action={
										filtered ? (
											<Button
												onAction={clearFilters}
												size="small"
												variant="secondary"
											>
												Clear filters
											</Button>
										) : (
											<Button
												href="/admin/installations"
												size="small"
												variant="secondary"
											>
												View installations
											</Button>
										)
									}
									art={<MascotArt mood="admin-table-empty" size="compact" />}
									colSpan={COLUMN_COUNT}
									description={
										filtered
											? "Try another protection filter or search."
											: "Repos appear after someone installs the app."
									}
									reason={filtered ? "no-results" : "empty"}
									title={
										filtered ? "No repos match this filter" : "No repos yet"
									}
								/>
							) : (
								repos.map((repo) => (
									<TableRow key={repo.id}>
										<TableCell>
											<span data-layout-role="admin-forge-repo">
												<ForgeMark forge={repo.forge} />
												<CodeText as="span">{repo.fullName}</CodeText>
											</span>
										</TableCell>
										<TableCell
											data-admin-column="repo-org"
											mono={repo.orgSlug !== null}
										>
											{repo.orgSlug ?? "Not claimed"}
										</TableCell>
										<TableCell>
											<Status
												size="small"
												status={repo.protected ? "ok" : "idle"}
											>
												{repo.protected ? "Protected" : "Not protected"}
											</Status>
										</TableCell>
										<TableCell data-admin-column="repo-added">
											{formatAdminDate(repo.installedAt)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
