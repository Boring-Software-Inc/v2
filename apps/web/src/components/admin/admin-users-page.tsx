import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { AccessStatusMark } from "#/components/admin/access-status-dot";
import { AdminPagination } from "#/components/admin/admin-pagination";
import { formatAdminDate } from "#/components/admin/format-admin-date";
import { UserSheet } from "#/components/admin/user-sheet/user-sheet";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
import { Avatar } from "#/design-system/ui/avatar";
import { Badge } from "#/design-system/ui/badge";
import { Button } from "#/design-system/ui/button";
import { Checkbox, CheckboxGroup } from "#/design-system/ui/checkbox";
import {
	FilterBar,
	FilterBarSearch,
	FilterToggle,
} from "#/design-system/ui/filter-bar";
import { RelativeTime } from "#/design-system/ui/relative-time";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/design-system/ui/segmented-control";
import { Switch } from "#/design-system/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableEmpty,
	TableHead,
	TableHeader,
	TableLoading,
	TableRow,
} from "#/design-system/ui/table";
import { toast } from "#/design-system/ui/toast";
import { Caption, Label, SupportingText } from "#/design-system/ui/typography";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import {
	reviewUserAccess,
	setUserRerunCooldownExempt,
} from "#/lib/admin.functions";
import { adminQueryKeys, adminUsersQueryOptions } from "#/lib/admin.query";
import { ADMIN_USER_STATUSES, type AdminUsersSearch } from "#/lib/admin-search";
import {
	pickFromPage,
	type SheetStep,
	sheetPosition,
} from "#/lib/admin-user-sheet";
import { pickValue } from "#/lib/pick-value";
import { trackEvent } from "#/lib/track";

type StatusFilter = AdminUsersSearch["status"];

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
	{ key: "all", label: "All" },
	{ key: "pending", label: "Pending" },
	{ key: "approved", label: "Approved" },
	{ key: "rejected", label: "Declined" },
];

const COLUMN_COUNT = 9;

export function AdminUsersPage() {
	const queryClient = useQueryClient();
	const {
		online,
		status,
		user: openUserId,
	} = useSearch({
		from: "/admin/users",
	});
	const navigate = useNavigate({ from: "/admin/users" });
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
					if (decision === "approve" && result.changed > 0) {
						trackEvent("beta_approved", { count: result.changed });
					}
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
				onError: (failure) => {
					toast.fail(
						failure instanceof Error
							? failure.message
							: "Tripwire couldn't save the access decision. Try again.",
					);
				},
			},
		);
	};

	const users = data?.users ?? [];
	const total = data?.total ?? 0;

	const openUser = (userId: string | undefined) => {
		void navigate({
			search: (prev) => ({ ...prev, user: userId }),
			replace: userId !== undefined && openUserId !== undefined,
			resetScroll: false,
		});
	};

	const position = sheetPosition({
		ids: users.map((user) => user.id),
		offset,
		pageSize: 50,
		total,
		userId: openUserId ?? "",
	});

	const step = async (target: SheetStep) => {
		if (!target) {
			return;
		}
		if (target.kind === "user") {
			openUser(target.id);
			return;
		}
		const page = await queryClient.fetchQuery(
			adminUsersQueryOptions({ ...filter, offset: target.offset }),
		);
		const picked = pickFromPage(
			page.users.map((user) => user.id),
			target.pick,
		);
		setOffset(target.offset);
		if (picked) {
			openUser(picked);
		}
	};
	const pendingIds = users
		.filter((user) => user.accessStatus === "pending")
		.map((user) => user.id);

	const setStatus = (value: string) => {
		const next = pickValue(ADMIN_USER_STATUSES, value);
		if (!next) {
			return;
		}
		setOffset(0);
		setSelected([]);
		void navigate({
			search: (prev) => ({ ...prev, status: next }),
			replace: true,
			resetScroll: false,
		});
	};

	const clearFilters = () => {
		setSearch("");
		setOffset(0);
		setSelected([]);
		void navigate({ search: {}, replace: true, resetScroll: false });
	};

	return (
		<DashboardLayout counts={{}}>
			<Page>
				<PageHeader
					description="Review beta access and manage the per-user re-run cooldown override."
					title="Users"
				/>
				<PageBody>
					<CheckboxGroup
						allValues={pendingIds}
						onValueChange={setSelected}
						value={selected}
					>
						<Table
							aria-busy={isLoading || undefined}
							aria-label="Users"
							data-admin-table="users"
							footer={
								<AdminPagination
									noun="users"
									offset={offset}
									onOffsetChange={setOffset}
									total={total}
								/>
							}
							toolbar={
								<FilterBar aria-label="Filter users">
									<SegmentedControl
										aria-label="Access status"
										onValueChange={setStatus}
										size="sm"
										value={status}
									>
										{STATUS_FILTERS.map((statusFilter) => (
											<SegmentedControlItem
												key={statusFilter.key}
												value={statusFilter.key}
											>
												{statusFilter.label}
											</SegmentedControlItem>
										))}
									</SegmentedControl>
									<FilterToggle
										onPressedChange={(pressed) => {
											setOffset(0);
											setSelected([]);
											void navigate({
												search: (prev) => ({
													...prev,
													online: pressed ? true : undefined,
												}),
												replace: true,
												resetScroll: false,
											});
										}}
										pressed={online === true}
									>
										Online now
									</FilterToggle>
									{selected.length > 0 ? (
										<div data-layout-role="admin-bulk-actions">
											<Caption>{selected.length} selected</Caption>
											<Button
												onClick={() => setSelected([])}
												size="sm"
												variant="secondary"
											>
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
									<FilterBarSearch
										aria-label="Search users"
										onValueChange={(value) => {
											setSearch(value);
											setOffset(0);
										}}
										placeholder="Login or email"
										value={search}
									/>
								</FilterBar>
							}
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
									<TableHead data-admin-column="user-personal-org">
										Personal org
									</TableHead>
									<TableHead data-admin-column="user-org-count" numeric>
										Orgs
									</TableHead>
									<TableHead data-admin-column="user-joined">Joined</TableHead>
									<TableHead data-admin-column="user-last-seen">
										Last seen
									</TableHead>
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
										action={
											filtered ? (
												<Button
													onClick={clearFilters}
													size="sm"
													variant="secondary"
												>
													Clear filters
												</Button>
											) : (
												<Button
													nativeButton={false}
													render={<Link to="/admin/orgs" />}
													size="sm"
													variant="secondary"
												>
													View orgs
												</Button>
											)
										}
										art={<MascotArt mood="admin-table-empty" size="compact" />}
										colSpan={COLUMN_COUNT}
										description={
											filtered
												? "Try another access status, online filter or search."
												: "New signups appear here as pending."
										}
										reason={filtered ? "no-results" : "empty"}
										title={
											filtered ? "No users match this filter" : "No users yet"
										}
									/>
								) : (
									users.map((user) => (
										<TableRow
											data-clickable=""
											key={user.id}
											onClick={(event) => {
												if (
													event.target instanceof Element &&
													event.target.closest(
														"button, a, input, label, [role='checkbox'], [role='switch'], [role='menuitem']",
													)
												) {
													return;
												}
												openUser(user.id);
											}}
											open={user.id === openUserId}
											selected={selected.includes(user.id)}
										>
											<TableCell>
												<Checkbox
													aria-label={`Select ${user.name}`}
													disabled={user.accessStatus !== "pending"}
													value={user.id}
												/>
											</TableCell>
											<TableCell>
												<button
													aria-label={`Open ${user.name}`}
													data-layout-role="admin-user-open"
													onClick={() => openUser(user.id)}
													type="button"
												>
													<Avatar
														decorative
														name={user.name}
														size="sm"
														src={user.image ?? undefined}
													/>
													<span>
														<span data-layout-role="admin-user-name">
															<Label>{user.name}</Label>
															{user.isPlatformAdmin ? (
																<Badge size="sm" variant="outline">
																	Staff
																</Badge>
															) : null}
														</span>
														<SupportingText as="span">
															{user.email}
														</SupportingText>
													</span>
												</button>
											</TableCell>
											<TableCell>
												<AccessStatusMark status={user.accessStatus} />
											</TableCell>
											<TableCell
												data-admin-column="user-personal-org"
												mono={user.personalOrgSlug !== null}
											>
												{user.personalOrgSlug ?? "None"}
											</TableCell>
											<TableCell data-admin-column="user-org-count" numeric>
												{user.membershipCount}
											</TableCell>
											<TableCell data-admin-column="user-joined">
												{formatAdminDate(user.createdAt)}
											</TableCell>
											<TableCell data-admin-column="user-last-seen">
												{user.lastSeenAt ? (
													<RelativeTime date={user.lastSeenAt} />
												) : (
													"Unknown"
												)}
											</TableCell>
											<TableCell>
												<Switch
													aria-label={`Skip re-run cooldown for ${user.name}`}
													checked={user.rerunCooldownExempt}
													onCheckedChange={(exempt) =>
														flagRerun.mutate(
															{ data: { userId: user.id, exempt } },
															{
																onSuccess: (result) => {
																	if (result.changed) {
																		toast.success(
																			exempt
																				? `${user.name} can re-run without the cooldown`
																				: `${user.name} has the re-run cooldown again`,
																		);
																	}
																},
																onError: () => {
																	toast.fail(
																		`Tripwire couldn't change the cooldown for ${user.name}. Try again.`,
																	);
																},
															},
														)
													}
													pending={
														flagRerun.isPending &&
														flagRerun.variables?.data.userId === user.id
													}
													size="sm"
												/>
											</TableCell>
											<TableCell>
												<div data-layout-role="admin-user-actions">
													{user.accessStatus !== "approved" ? (
														<Button
															disabled={review.isPending}
															onClick={() => decide([user.id], "approve")}
															size="sm"
															variant="secondary"
														>
															Approve
														</Button>
													) : null}
													{user.accessStatus !== "rejected" ? (
														confirmRejectId === user.id ? (
															<Button
																aria-label={`Confirm decline for ${user.name}`}
																onBlur={() => setConfirmRejectId(null)}
																onClick={() => decide([user.id], "reject")}
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
																aria-label={`Decline ${user.name}`}
																disabled={review.isPending}
																onClick={() => setConfirmRejectId(user.id)}
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
				</PageBody>
			</Page>
			<UserSheet
				onClose={() => openUser(undefined)}
				onStep={(target) => void step(target)}
				position={position}
				userId={openUserId}
			/>
		</DashboardLayout>
	);
}
