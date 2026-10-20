import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccessStatus } from "@tripwire/contracts";
import { useState } from "react";
import { AccessStatusMark } from "#/components/admin/access-status-dot";
import { formatAdminDate } from "#/components/admin/format-admin-date";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { Checkbox, CheckboxGroup } from "#/components/glaze/ui/checkbox";
import { Input } from "#/components/glaze/ui/input";
import { PaginationInfo } from "#/components/glaze/ui/pagination";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { Switch } from "#/components/glaze/ui/switch";
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
import { toast } from "#/components/glaze/ui/toast";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import {
	reviewUserAccess,
	setUserRerunCooldownExempt,
} from "#/lib/admin.functions";
import {
	ADMIN_PAGE_SIZE,
	adminQueryKeys,
	adminUsersQueryOptions,
} from "#/lib/admin.query";

type StatusFilter = AccessStatus | "all";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
	{ key: "all", label: "All" },
	{ key: "pending", label: "Pending" },
	{ key: "approved", label: "Approved" },
	{ key: "rejected", label: "Rejected" },
];

const COLUMN_COUNT = 8;

export function AdminUsersPage() {
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<StatusFilter>("all");
	const [search, setSearch] = useState("");
	const [offset, setOffset] = useState(0);
	const [selected, setSelected] = useState<string[]>([]);
	const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);
	const debouncedSearch = useDebouncedValue(search, 250);

	const filter = {
		status: status === "all" ? undefined : status,
		search: debouncedSearch || undefined,
		offset,
	};
	const { data, isLoading } = useQuery(adminUsersQueryOptions(filter));

	const review = useMutation({
		mutationFn: reviewUserAccess,
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: adminQueryKeys.all }),
	});

	const flagRerun = useMutation({
		mutationFn: setUserRerunCooldownExempt,
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: adminQueryKeys.all }),
	});

	const decide = (userIds: string[], decision: "approve" | "reject") => {
		review.mutate(
			{ data: { userIds, decision } },
			{
				onSuccess: (result) => {
					setSelected([]);
					setConfirmRejectId(null);
					toast(
						decision === "approve"
							? `Approved ${result.changed} of ${result.total}`
							: `Rejected ${result.changed} of ${result.total}`,
					);
				},
			},
		);
	};

	const users = data?.users ?? [];
	const total = data?.total ?? 0;
	const pendingIds = users
		.filter((u) => u.accessStatus === "pending")
		.map((u) => u.id);

	const setFilter = (next: string) => {
		setStatus(next as StatusFilter);
		setOffset(0);
		setSelected([]);
	};

	const toolbar = (
		<>
			<SegmentedControl
				aria-label="Access status"
				onValueChange={(value) => setFilter(String(value))}
				size="sm"
				value={status}
			>
				{STATUS_FILTERS.map((f) => (
					<SegmentedControlItem key={f.key} value={f.key}>
						{f.label}
					</SegmentedControlItem>
				))}
			</SegmentedControl>
			{selected.length > 0 ? (
				<div className="flex items-center gap-2">
					<span className="type-caption text-text-2 tabular-nums">
						{selected.length} selected
					</span>
					<Button onClick={() => setSelected([])} size="sm" variant="secondary">
						Clear
					</Button>
					<Button
						onClick={() => decide(selected, "approve")}
						pending={review.isPending}
						size="sm"
					>
						Approve selected
					</Button>
				</div>
			) : null}
			<Input
				aria-label="Search users"
				className="ms-auto w-full sm:w-56"
				mode="search"
				onValueChange={(value) => {
					setSearch(value);
					setOffset(0);
				}}
				placeholder="Login or email"
				size="sm"
				value={search}
			/>
		</>
	);

	const footer = (
		<>
			{total === 0 ? (
				<span>0 users</span>
			) : (
				<PaginationInfo
					from={offset + 1}
					noun="users"
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
				<div className="mx-auto flex w-full flex-col gap-6">
					<header className="flex flex-col gap-1">
						<h1 className="type-title">Users</h1>
						<p className="max-w-measure type-body text-text-2">
							Beta access review. Approve writes through the same promotion path
							invite redemption uses. The re-run cooldown duration is env-global
							(<code>RERUN_COOLDOWN_SECONDS</code>); the per-account exempt flag
							is toggled below.
						</p>
					</header>

					<CheckboxGroup
						allValues={pendingIds}
						className="block"
						onValueChange={setSelected}
						value={selected}
					>
						<Table
							aria-busy={isLoading || undefined}
							aria-label="Users"
							footer={footer}
							toolbar={toolbar}
						>
							<TableHeader>
								<TableRow>
									<TableHead>
										<Checkbox
											aria-label="Select all pending on this page"
											checked={pendingIds.length === 0 ? false : undefined}
											disabled={pendingIds.length === 0}
											parent={pendingIds.length > 0}
										/>
									</TableHead>
									<TableHead>User</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Personal org</TableHead>
									<TableHead numeric>Orgs</TableHead>
									<TableHead>Joined</TableHead>
									<TableHead>No cooldown</TableHead>
									<TableHead>
										<span className="sr-only">Actions</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{isLoading ? (
									<TableLoading
										columns={[
											{ checkbox: true },
											{},
											{},
											{},
											{ numeric: true },
											{},
											{},
											{},
										]}
									/>
								) : users.length === 0 ? (
									<TableEmpty
										colSpan={COLUMN_COUNT}
										description="New signups land as pending."
										reason={
											status === "all" && !debouncedSearch
												? "empty"
												: "no-results"
										}
										title="No users match this filter"
									/>
								) : (
									users.map((u) => (
										<TableRow key={u.id} selected={selected.includes(u.id)}>
											<TableCell>
												<Checkbox
													aria-label={`Select ${u.name}`}
													disabled={u.accessStatus !== "pending"}
													value={u.id}
												/>
											</TableCell>
											<TableCell>
												<div className="flex min-w-0 items-center gap-2">
													<Avatar
														decorative
														name={u.name}
														size="sm"
														src={u.image ?? undefined}
													/>
													<div className="flex min-w-0 flex-col">
														<span className="flex items-center gap-1 truncate type-label">
															{u.name}
															{u.isPlatformAdmin ? (
																<Badge size="sm" variant="outline">
																	Staff
																</Badge>
															) : null}
														</span>
														<span className="truncate type-caption text-text-2">
															{u.email}
														</span>
													</div>
												</div>
											</TableCell>
											<TableCell>
												<AccessStatusMark status={u.accessStatus} />
											</TableCell>
											<TableCell
												className="text-text-2"
												mono={u.personalOrgSlug !== null}
											>
												{u.personalOrgSlug ?? "None"}
											</TableCell>
											<TableCell numeric>{u.membershipCount}</TableCell>
											<TableCell className="text-text-2">
												{formatAdminDate(u.createdAt)}
											</TableCell>
											<TableCell>
												<Switch
													aria-label={`Exempt ${u.name} from re-run cooldown`}
													checked={u.rerunCooldownExempt}
													onCheckedChange={(exempt) =>
														flagRerun.mutate(
															{ data: { userId: u.id, exempt } },
															{
																onSuccess: (result) => {
																	if (result.changed) {
																		toast(
																			exempt
																				? "Re-run cooldown exempt"
																				: "Re-run cooldown restored",
																		);
																	}
																},
															},
														)
													}
													pending={
														flagRerun.isPending &&
														flagRerun.variables?.data.userId === u.id
													}
													size="sm"
												/>
											</TableCell>
											<TableCell>
												<div className="flex items-center justify-end gap-2">
													{u.accessStatus !== "approved" ? (
														<Button
															disabled={review.isPending}
															onClick={() => decide([u.id], "approve")}
															size="sm"
															variant="secondary"
														>
															Approve
														</Button>
													) : null}
													{u.accessStatus !== "rejected" ? (
														confirmRejectId === u.id ? (
															<Button
																onClick={() => decide([u.id], "reject")}
																pending={review.isPending}
																size="sm"
																variant="destructive"
															>
																Confirm reject
															</Button>
														) : (
															<Button
																disabled={review.isPending}
																onClick={() => setConfirmRejectId(u.id)}
																size="sm"
																variant="secondary"
															>
																Reject
															</Button>
														)
													) : null}
												</div>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</CheckboxGroup>
				</div>
			</div>
		</DashboardLayout>
	);
}
