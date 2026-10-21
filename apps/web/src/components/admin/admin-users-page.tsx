import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { AccessStatus } from "@tripwire/contracts";
import { useState } from "react";
import { AccessStatusMark } from "#/components/admin/access-status-dot";
import { formatAdminDate } from "#/components/admin/format-admin-date";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { Checkbox, CheckboxGroup } from "#/components/glaze/ui/checkbox";
import { Chip } from "#/components/glaze/ui/chip";
import { Input } from "#/components/glaze/ui/input";
import { PaginationInfo } from "#/components/glaze/ui/pagination";
import { RelativeTime } from "#/components/glaze/ui/relative-time";
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
import { MascotArt } from "#/components/mascot/mascot-art";
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
	{ key: "rejected", label: "Declined" },
];

const COLUMN_COUNT = 9;

export function AdminUsersPage() {
	const queryClient = useQueryClient();
	const { online } = useSearch({ from: "/admin/users" });
	const navigate = useNavigate({ from: "/admin/users" });
	const [status, setStatus] = useState<StatusFilter>("all");
	const [search, setSearch] = useState("");
	const [offset, setOffset] = useState(0);
	const [selected, setSelected] = useState<string[]>([]);
	const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);
	const debouncedSearch = useDebouncedValue(search, 250);

	const filter = {
		status: status === "all" ? undefined : status,
		search: debouncedSearch || undefined,
		online,
		offset,
	};
	const filtered =
		status !== "all" || debouncedSearch !== "" || online === true;
	const { data, isLoading, error, refetch } = useQuery(
		adminUsersQueryOptions(filter),
	);

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
					const verb = decision === "approve" ? "Approved" : "Declined";
					const noun = result.total === 1 ? "user" : "users";
					toast.success(
						result.changed === result.total
							? `${verb} ${result.total} ${noun}`
							: `${verb} ${result.changed} of ${result.total} ${noun}. The rest already had that status.`,
					);
				},
				onError: (error) => {
					toast.fail(
						error instanceof Error
							? error.message
							: "Tripwire couldn't save the access decision. Try again.",
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
				value={status}
			>
				{STATUS_FILTERS.map((f) => (
					<SegmentedControlItem key={f.key} value={f.key}>
						{f.label}
					</SegmentedControlItem>
				))}
			</SegmentedControl>
			<Chip
				onPressedChange={(pressed) => {
					setOffset(0);
					setSelected([]);
					void navigate({ search: pressed ? { online: true } : {} });
				}}
				pressed={online === true}
			>
				Online now
			</Chip>
			{selected.length > 0 ? (
				<div className="flex items-center gap-2">
					<span className="type-caption text-text-2 tabular-nums">
						{selected.length} selected
					</span>
					<Button onClick={() => setSelected([])} size="sm" variant="secondary">
						Clear selection
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
				<div className="mx-auto flex w-full max-w-312 flex-col gap-6">
					<header className="flex flex-col gap-1">
						<h1 className="type-title">Users</h1>
						<p className="max-w-measure type-body text-text-2">
							Review beta access requests. Approving a user gives the same
							access as accepting an invite. The re-run cooldown comes from{" "}
							<code>RERUN_COOLDOWN_SECONDS</code> and applies to every user. Use
							the Skip cooldown switch to turn it off for one user.
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
									<TableHead>Last seen</TableHead>
									<TableHead>Skip cooldown</TableHead>
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
											{},
										]}
									/>
								) : error ? (
									<TableEmpty
										action={
											<Button
												onClick={() => void refetch()}
												size="sm"
												variant="secondary"
											>
												Load users again
											</Button>
										}
										colSpan={COLUMN_COUNT}
										description={error.message}
										reason="error"
										title="Tripwire couldn't load users"
									/>
								) : users.length === 0 ? (
									<TableEmpty
										art={<MascotArt mood="admin-table-empty" size="compact" />}
										colSpan={COLUMN_COUNT}
										description={
											filtered
												? "Try another status or search."
												: "New signups show up here as pending."
										}
										reason={filtered ? "no-results" : "empty"}
										title={
											filtered ? "No users match this filter" : "No users yet"
										}
										action={
											!filtered ? (
												<Button
													nativeButton={false}
													render={<Link to="/admin/orgs" />}
													size="sm"
													variant="secondary"
												>
													View orgs
												</Button>
											) : (
												<Button
													onClick={() => {
														setStatus("all");
														setSearch("");
														setOffset(0);
														void navigate({ search: {} });
													}}
													size="sm"
													variant="secondary"
												>
													Clear filters
												</Button>
											)
										}
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
											<TableCell className="text-text-2">
												{u.lastSeenAt ? (
													<RelativeTime date={u.lastSeenAt} />
												) : (
													"Unknown"
												)}
											</TableCell>
											<TableCell>
												<Switch
													aria-label={`Skip re-run cooldown for ${u.name}`}
													checked={u.rerunCooldownExempt}
													onCheckedChange={(exempt) =>
														flagRerun.mutate(
															{ data: { userId: u.id, exempt } },
															{
																onSuccess: (result) => {
																	if (result.changed) {
																		toast.success(
																			exempt
																				? `${u.name} can re-run without the cooldown`
																				: `${u.name} has the re-run cooldown again`,
																		);
																	}
																},
																onError: () => {
																	toast.fail(
																		`Tripwire couldn't change the cooldown for ${u.name}. Try again.`,
																	);
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
																aria-label={`Confirm decline for ${u.name}`}
																onBlur={() => setConfirmRejectId(null)}
																onClick={() => decide([u.id], "reject")}
																onKeyDown={(event) => {
																	if (event.key === "Escape") {
																		setConfirmRejectId(null);
																	}
																}}
																pending={review.isPending}
																ref={(node: HTMLButtonElement | null) =>
																	node?.focus()
																}
																size="sm"
																variant="destructive"
															>
																Confirm decline
															</Button>
														) : (
															<Button
																aria-label={`Decline ${u.name}`}
																disabled={review.isPending}
																onClick={() => setConfirmRejectId(u.id)}
																size="sm"
																variant="secondary"
															>
																Decline
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
