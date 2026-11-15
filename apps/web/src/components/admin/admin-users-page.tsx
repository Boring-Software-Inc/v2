import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AgentBoundary } from "@tripwire/ui/agent-policy";
import { Avatar } from "@tripwire/ui/avatar";
import { Badge } from "@tripwire/ui/badge";
import { Button } from "@tripwire/ui/button";
import { Checkbox } from "@tripwire/ui/checkbox";
import { DestructiveDialog } from "@tripwire/ui/dialog";
import { SegmentedControl } from "@tripwire/ui/radio-group";
import { RelativeTime } from "@tripwire/ui/relative-time";
import { Switch } from "@tripwire/ui/switch";
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
import { notify } from "@tripwire/ui/toast";
import { Caption, Label, SupportingText } from "@tripwire/ui/typography";
import { useState } from "react";
import { AccessStatusMark } from "#/components/admin/access-status-dot";
import { AdminPagination } from "#/components/admin/admin-pagination";
import { formatAdminDate } from "#/components/admin/format-admin-date";
import { UserSheet } from "#/components/admin/user-sheet/user-sheet";
import {
	FilterBar,
	FilterBarSearch,
	FilterToggle,
} from "#/components/common/filter-bar";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
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
					const verb = decision === "approve" ? "Approved" : "Declined";
					const noun = result.total === 1 ? "user" : "users";
					notify.show(
						{
							title:
								result.changed === result.total
									? `${verb} ${result.total} ${noun}`
									: `${verb} ${result.changed} of ${result.total} ${noun}. The rest already had that status.`,
						},
						"success",
					);
				},
				onError: (failure) => {
					notify.show(
						{
							title:
								failure instanceof Error
									? failure.message
									: "Tripwire couldn't save the access decision. Try again.",
						},
						"error",
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
									ariaLabel="Access status"
									onValueChange={(value) => value && setStatus(value)}
									options={STATUS_FILTERS.map((statusFilter) => ({
										label: statusFilter.label,
										value: statusFilter.key,
									}))}
									size="small"
									value={status}
								/>
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
											onAction={() => setSelected([])}
											size="small"
											variant="secondary"
										>
											Clear selection
										</Button>
										<AgentBoundary visibility="hidden">
											<Button
												onAction={() => decide(selected, "approve")}
												pending={review.isPending}
												size="small"
											>
												Approve selected
											</Button>
										</AgentBoundary>
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
										ariaLabel="Select all pending on this page"
										checked={
											selected.length === 0
												? false
												: selected.length === pendingIds.length
													? true
													: "indeterminate"
										}
										disabled={pendingIds.length === 0}
										onCheckedChange={(checked) =>
											setSelected(checked === true ? pendingIds : [])
										}
										size="small"
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
								<TableHead data-admin-column="user-skip-cooldown">
									Skip cooldown
								</TableHead>
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
											onAction={() => void refetch()}
											size="small"
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
												onAction={clearFilters}
												size="small"
												variant="secondary"
											>
												Clear filters
											</Button>
										) : (
											<Button
												href="/admin/orgs"
												size="small"
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
												ariaLabel={`Select ${user.name}`}
												checked={selected.includes(user.id)}
												disabled={user.accessStatus !== "pending"}
												onCheckedChange={(checked) =>
													setSelected((current) =>
														checked === true
															? [...current, user.id]
															: current.filter((id) => id !== user.id),
													)
												}
												size="small"
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
															<Badge size="small" variant="outline">
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
										<TableCell data-admin-column="user-skip-cooldown">
											<AgentBoundary visibility="hidden">
												<Switch
													ariaLabel={`Skip re-run cooldown for ${user.name}`}
													checked={user.rerunCooldownExempt}
													onCheckedChange={(exempt) =>
														flagRerun.mutate(
															{ data: { userId: user.id, exempt } },
															{
																onSuccess: (result) => {
																	if (result.changed) {
																		notify.show(
																			{
																				title: exempt
																					? `${user.name} can re-run without the cooldown`
																					: `${user.name} has the re-run cooldown again`,
																			},
																			"success",
																		);
																	}
																},
																onError: () => {
																	notify.show(
																		{
																			title: `Tripwire couldn't change the cooldown for ${user.name}. Try again.`,
																		},
																		"error",
																	);
																},
															},
														)
													}
													pending={
														flagRerun.isPending &&
														flagRerun.variables?.data.userId === user.id
													}
													size="small"
												/>
											</AgentBoundary>
										</TableCell>
										<TableCell>
											<div data-layout-role="admin-user-actions">
												<AgentBoundary visibility="hidden">
													{user.accessStatus !== "approved" ? (
														<Button
															disabled={review.isPending}
															onAction={() => decide([user.id], "approve")}
															size="small"
															variant="secondary"
														>
															Approve
														</Button>
													) : null}
													{user.accessStatus !== "rejected" ? (
														<DeclineAccess
															disabled={review.isPending}
															name={user.name}
															onDecline={() => decide([user.id], "reject")}
														/>
													) : null}
												</AgentBoundary>
											</div>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
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

function DeclineAccess({
	disabled,
	name,
	onDecline,
}: {
	disabled: boolean;
	name: string;
	onDecline: () => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<DestructiveDialog
			agentVisibility="hidden"
			confirmLabel="Decline user"
			description={`${name} will lose beta access.`}
			onConfirm={onDecline}
			onOpenChange={setOpen}
			open={open}
			pendingLabel="Declining"
			title={`Decline ${name}?`}
			trigger={{
				ariaLabel: `Decline ${name}`,
				disabled,
				label: "Decline",
				size: "small",
			}}
		/>
	);
}
