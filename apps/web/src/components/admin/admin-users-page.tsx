import { UserMultipleIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccessStatus } from "@tripwire/contracts";
import { useState } from "react";
import { toast } from "sonner";
import { AccessStatusDot } from "#/components/admin/access-status-dot";
import { formatAdminDate } from "#/components/admin/format-admin-date";
import { EmptyState } from "#/components/common/empty-state";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { reviewUserAccess } from "#/lib/admin.functions";
import {
	ADMIN_PAGE_SIZE,
	adminQueryKeys,
	adminUsersQueryOptions,
} from "#/lib/admin.query";
import { cn } from "#/lib/utils";

const STATUS_FILTERS: Array<{ key: AccessStatus | "all"; label: string }> = [
	{ key: "all", label: "all" },
	{ key: "pending", label: "pending" },
	{ key: "approved", label: "approved" },
	{ key: "rejected", label: "rejected" },
];

/**
 * /admin/users — beta access review. Approve and reject both write through
 * the access.ts paths (the same promotion invite redemption uses); reject is
 * a two-step confirm because it is the harsher direction.
 */
export function AdminUsersPage() {
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<AccessStatus | "all">("all");
	const [search, setSearch] = useState("");
	const [offset, setOffset] = useState(0);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);
	const debouncedSearch = useDebouncedValue(search, 250);

	const filter = {
		status: status === "all" ? undefined : status,
		search: debouncedSearch || undefined,
		offset,
	};
	const { data } = useQuery(adminUsersQueryOptions(filter));

	const review = useMutation({
		mutationFn: reviewUserAccess,
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: adminQueryKeys.all }),
	});

	const decide = (userIds: string[], decision: "approve" | "reject") => {
		review.mutate(
			{ data: { userIds, decision } },
			{
				onSuccess: (result) => {
					setSelected(new Set());
					setConfirmRejectId(null);
					toast(
						decision === "approve"
							? `approved ${result.changed} of ${result.total}`
							: `rejected ${result.changed} of ${result.total}`,
					);
				},
			},
		);
	};

	const users = data?.users ?? [];
	const total = data?.total ?? 0;
	const pendingOnPage = users.filter((u) => u.accessStatus === "pending");
	const allPendingSelected =
		pendingOnPage.length > 0 && pendingOnPage.every((u) => selected.has(u.id));

	const toggleAllPending = () => {
		setSelected(
			allPendingSelected ? new Set() : new Set(pendingOnPage.map((u) => u.id)),
		);
	};

	const toggleOne = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const setFilter = (next: AccessStatus | "all") => {
		setStatus(next);
		setOffset(0);
		setSelected(new Set());
	};

	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-5xl px-6 py-8">
				<header className="mb-6">
					<h1 className="font-semibold text-2xl tracking-tight">Users</h1>
					<p className="text-muted-foreground text-sm">
						beta access review. approve writes through the same promotion path
						invite redemption uses.
					</p>
				</header>

				<div className="mb-4 flex flex-wrap items-center gap-2">
					{STATUS_FILTERS.map((f) => (
						<button
							className={cn(
								"rounded-full px-3 py-1 text-xs transition-colors",
								status === f.key
									? "bg-foreground text-background"
									: "bg-surface-1 text-muted-foreground hover:text-foreground",
							)}
							key={f.key}
							onClick={() => setFilter(f.key)}
							type="button"
						>
							{f.label}
						</button>
					))}
					<Input
						className="ml-auto h-8 max-w-56"
						onChange={(e) => {
							setSearch(e.target.value);
							setOffset(0);
						}}
						placeholder="search login or email"
						value={search}
					/>
				</div>

				{selected.size > 0 ? (
					<div className="mb-3 flex items-center gap-3 rounded-lg border bg-surface-1 px-4 py-2">
						<span className="text-muted-foreground text-xs">
							{selected.size} selected
						</span>
						<Button
							disabled={review.isPending}
							onClick={() => decide([...selected], "approve")}
							size="xs"
							variant="secondary"
						>
							approve selected
						</Button>
						<Button
							onClick={() => setSelected(new Set())}
							size="xs"
							variant="ghost"
						>
							clear
						</Button>
					</div>
				) : null}

				{users.length === 0 ? (
					<EmptyState
						description="no users match this filter. new signups land as pending."
						icon={UserMultipleIcon}
						title="nobody here"
					/>
				) : (
					<div className="overflow-hidden rounded-xl border bg-card">
						<div className="flex items-center gap-3 bg-surface-1 px-4 py-2 text-muted-foreground text-xs">
							<input
								aria-label="select all pending on this page"
								checked={allPendingSelected}
								className="accent-foreground"
								disabled={pendingOnPage.length === 0}
								onChange={toggleAllPending}
								type="checkbox"
							/>
							<span className="min-w-0 flex-1">user</span>
							<span className="w-20 shrink-0">status</span>
							<span className="hidden w-24 shrink-0 sm:block">
								personal org
							</span>
							<span className="hidden w-12 shrink-0 text-right sm:block">
								orgs
							</span>
							<span className="hidden w-24 shrink-0 md:block">joined</span>
							<span className="w-36 shrink-0" />
						</div>
						{users.map((u) => (
							<div
								className="flex items-center gap-3 border-t px-4 py-2.5 transition-colors hover:bg-surface-1"
								key={u.id}
							>
								<input
									aria-label={`select ${u.name}`}
									checked={selected.has(u.id)}
									className="accent-foreground"
									disabled={u.accessStatus !== "pending"}
									onChange={() => toggleOne(u.id)}
									type="checkbox"
								/>
								<div className="flex min-w-0 flex-1 items-center gap-2.5">
									{u.image ? (
										<img
											alt=""
											className="size-5 shrink-0 rounded-full"
											crossOrigin="anonymous"
											src={u.image}
										/>
									) : (
										<span className="size-5 shrink-0 rounded-full bg-surface-2" />
									)}
									<div className="min-w-0">
										<p className="truncate font-medium text-sm">
											{u.name}
											{u.isPlatformAdmin ? (
												<span className="ml-1.5 text-muted-foreground text-xs">
													staff
												</span>
											) : null}
										</p>
										<p className="truncate text-muted-foreground text-xs">
											{u.email}
										</p>
									</div>
								</div>
								<span className="w-20 shrink-0">
									<AccessStatusDot status={u.accessStatus} />
								</span>
								<span className="hidden w-24 shrink-0 truncate text-muted-foreground text-xs sm:block">
									{u.personalOrgSlug ?? "–"}
								</span>
								<span className="hidden w-12 shrink-0 text-right text-muted-foreground text-xs tabular-nums sm:block">
									{u.membershipCount}
								</span>
								<span className="hidden w-24 shrink-0 text-muted-foreground text-xs md:block">
									{formatAdminDate(u.createdAt)}
								</span>
								<span className="flex w-36 shrink-0 items-center justify-end gap-1.5">
									{u.accessStatus !== "approved" ? (
										<button
											className="rounded-md bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-600 text-xs transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
											disabled={review.isPending}
											onClick={() => decide([u.id], "approve")}
											type="button"
										>
											approve
										</button>
									) : null}
									{u.accessStatus !== "rejected" ? (
										confirmRejectId === u.id ? (
											<button
												className="rounded-md bg-red-500/20 px-2.5 py-1 font-medium text-red-600 text-xs transition-colors hover:bg-red-500/30 dark:text-red-400"
												disabled={review.isPending}
												onClick={() => decide([u.id], "reject")}
												type="button"
											>
												confirm reject
											</button>
										) : (
											<button
												className="rounded-md bg-red-500/10 px-2.5 py-1 font-medium text-red-600 text-xs transition-colors hover:bg-red-500/20 dark:text-red-400"
												disabled={review.isPending}
												onClick={() => setConfirmRejectId(u.id)}
												type="button"
											>
												reject
											</button>
										)
									) : null}
								</span>
							</div>
						))}
					</div>
				)}

				<div className="mt-4 flex items-center justify-between text-muted-foreground text-xs">
					<span>
						{total === 0
							? "0 users"
							: `${offset + 1}–${Math.min(offset + ADMIN_PAGE_SIZE, total)} of ${total}`}
					</span>
					<div className="flex gap-1.5">
						<Button
							disabled={offset === 0}
							onClick={() => setOffset(Math.max(0, offset - ADMIN_PAGE_SIZE))}
							size="xs"
							variant="outline"
						>
							prev
						</Button>
						<Button
							disabled={offset + ADMIN_PAGE_SIZE >= total}
							onClick={() => setOffset(offset + ADMIN_PAGE_SIZE)}
							size="xs"
							variant="outline"
						>
							next
						</Button>
					</div>
				</div>
			</div>
		</DashboardLayout>
	);
}
