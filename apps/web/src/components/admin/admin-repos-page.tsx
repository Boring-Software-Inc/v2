import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { formatAdminDate } from "#/components/admin/format-admin-date";
import { ForgeMark } from "#/components/common/forge-marks";
import { Button } from "#/components/glaze/ui/button";
import { FilterBarSearch } from "#/components/glaze/ui/filter-bar";
import { PaginationInfo } from "#/components/glaze/ui/pagination";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { Status } from "#/components/glaze/ui/status";
import {
	Table,
	TableBody,
	TableCell,
	TableEmpty,
	TableHead,
	TableHeader,
	TableLoading,
	TableRow,
} from "#/components/glaze/ui/table";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { MascotArt } from "#/components/mascot/mascot-art";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { ADMIN_PAGE_SIZE, adminReposQueryOptions } from "#/lib/admin.query";
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

	const toolbar = (
		<>
			<SegmentedControl
				size="sm"
				aria-label="Protection"
				onValueChange={setStatus}
				value={status}
			>
				{STATUS_FILTERS.map((f) => (
					<SegmentedControlItem key={f.key} value={f.key}>
						{f.label}
					</SegmentedControlItem>
				))}
			</SegmentedControl>
			<FilterBarSearch
				aria-label="Search repos"
				className="ms-auto w-full sm:w-56 sm:flex-none"
				onValueChange={(value) => {
					setSearch(value);
					setOffset(0);
				}}
				placeholder="Owner or name"
				value={search}
			/>
		</>
	);

	const footer = (
		<>
			{total === 0 ? (
				<span>0 repos</span>
			) : (
				<PaginationInfo
					from={offset + 1}
					noun="repos"
					to={Math.min(offset + ADMIN_PAGE_SIZE, total)}
					total={total}
				/>
			)}
			<div className="flex gap-2">
				<Button
					disabled={offset === 0}
					onClick={() => setOffset(Math.max(0, offset - ADMIN_PAGE_SIZE))}
					size="sm"
					variant="secondary"
				>
					Previous
				</Button>
				<Button
					disabled={offset + ADMIN_PAGE_SIZE >= total}
					onClick={() => setOffset(offset + ADMIN_PAGE_SIZE)}
					size="sm"
					variant="secondary"
				>
					Next
				</Button>
			</div>
		</>
	);

	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-312 flex-col gap-6">
					<header className="flex flex-col gap-1">
						<h1 className="type-title">Repos</h1>
						<p className="type-body text-text-2">
							Every connected repo on this Tripwire server.
						</p>
					</header>

					<Table
						aria-busy={isLoading || undefined}
						aria-label="Repos"
						footer={footer}
						toolbar={toolbar}
					>
						<TableHeader>
							<TableRow>
								<TableHead>Repo</TableHead>
								<TableHead>Org</TableHead>
								<TableHead>Tripwire</TableHead>
								<TableHead>Added</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableLoading columns={[{}, {}, {}, {}]} />
							) : error ? (
								<TableEmpty
									action={
										<Button
											onClick={() => void refetch()}
											size="sm"
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
									art={<MascotArt mood="admin-table-empty" size="compact" />}
									colSpan={COLUMN_COUNT}
									description={
										filtered
											? "Try another filter or search."
											: "Repos show up here when someone installs the app."
									}
									reason={filtered ? "no-results" : "empty"}
									title={
										filtered ? "No repos match this filter" : "No repos yet"
									}
									action={
										filtered ? (
											<Button
												onClick={() => {
													setSearch("");
													setStatus("all");
												}}
												size="sm"
												variant="secondary"
											>
												Clear filters
											</Button>
										) : (
											<Button
												nativeButton={false}
												render={<Link to="/admin/installations" />}
												size="sm"
												variant="secondary"
											>
												View installations
											</Button>
										)
									}
								/>
							) : (
								repos.map((repo) => (
									<TableRow key={repo.id}>
										<TableCell>
											<span className="flex min-w-0 items-center gap-2">
												<ForgeMark
													className="size-(--icon-sm) shrink-0 text-text-2"
													forge={repo.forge}
												/>
												<span className="truncate mono type-label">
													{repo.fullName}
												</span>
											</span>
										</TableCell>
										<TableCell
											className="text-text-2"
											mono={repo.orgSlug !== null}
										>
											{repo.orgSlug ?? "Not claimed"}
										</TableCell>
										<TableCell>
											<Status size="sm" status={repo.protected ? "ok" : "idle"}>
												{repo.protected ? "Protected" : "Not protected"}
											</Status>
										</TableCell>
										<TableCell className="text-text-2">
											{formatAdminDate(repo.installedAt)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</div>
		</DashboardLayout>
	);
}
