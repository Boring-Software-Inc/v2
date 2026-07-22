import { Building03Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgRole } from "@tripwire/contracts";
import { useState } from "react";
import { formatAdminDate } from "#/components/admin/format-admin-date";
import { EmptyState } from "#/components/common/empty-state";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { toast } from "#/components/ui/toast";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { adminUpdateOrgMemberRole } from "#/lib/admin.functions";
import {
	ADMIN_PAGE_SIZE,
	adminOrgMembersQueryOptions,
	adminOrgsQueryOptions,
	adminQueryKeys,
} from "#/lib/admin.query";
import { cn } from "#/lib/utils";

const KIND_FILTERS = [
	{ key: "all", label: "all" },
	{ key: "team", label: "team" },
	{ key: "personal", label: "personal" },
] as const;

type OrgKind = (typeof KIND_FILTERS)[number]["key"];

/**
 * /admin/orgs — org inspection. Role changes route through
 * updateMemberRoleForStaff, which runs the SAME guard as the plugin hook —
 * the portal cannot demote a last admin or touch a personal org.
 */
export function AdminOrgsPage() {
	const [kind, setKind] = useState<OrgKind>("all");
	const [search, setSearch] = useState("");
	const [offset, setOffset] = useState(0);
	const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
	const debouncedSearch = useDebouncedValue(search, 250);

	const { data } = useQuery(
		adminOrgsQueryOptions({
			kind: kind === "all" ? undefined : kind,
			search: debouncedSearch || undefined,
			offset,
		}),
	);

	const orgs = data?.orgs ?? [];
	const total = data?.total ?? 0;

	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-5xl px-6 py-8">
				<header className="mb-6">
					<h1 className="font-semibold text-2xl tracking-tight">Orgs</h1>
					<p className="text-muted-foreground text-sm">
						every org on the platform. expand a row to see members and fix
						roles.
					</p>
				</header>

				<div className="mb-4 flex flex-wrap items-center gap-2">
					{KIND_FILTERS.map((f) => (
						<button
							className={cn(
								"rounded-full px-3 py-1 text-xs transition-colors",
								kind === f.key
									? "bg-foreground text-background"
									: "bg-surface-1 text-muted-foreground hover:text-foreground",
							)}
							key={f.key}
							onClick={() => {
								setKind(f.key);
								setOffset(0);
							}}
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
						placeholder="search name or slug"
						value={search}
					/>
				</div>

				{orgs.length === 0 ? (
					<EmptyState
						description="no orgs match this filter."
						icon={Building03Icon}
						title="nothing here"
					/>
				) : (
					<div className="overflow-hidden rounded-xl border bg-card">
						<div className="flex items-center gap-3 bg-surface-1 px-4 py-2 text-muted-foreground text-xs">
							<span className="min-w-0 flex-1">org</span>
							<span className="w-16 shrink-0">kind</span>
							<span className="w-16 shrink-0 text-right">members</span>
							<span className="w-14 shrink-0 text-right">repos</span>
							<span className="hidden w-24 shrink-0 md:block">created</span>
						</div>
						{orgs.map((org) => (
							<div className="border-t" key={org.id}>
								<button
									className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-1"
									onClick={() =>
										setExpandedOrgId(expandedOrgId === org.id ? null : org.id)
									}
									type="button"
								>
									<div className="flex min-w-0 flex-1 items-center gap-2.5">
										<OrgAvatar hue={org.avatarHue} name={org.name} size={20} />
										<div className="min-w-0">
											<p className="truncate font-medium text-sm">{org.name}</p>
											<p className="truncate text-muted-foreground text-xs">
												{org.slug}
											</p>
										</div>
									</div>
									<span className="w-16 shrink-0 text-muted-foreground text-xs">
										{org.isPersonal ? "personal" : "team"}
									</span>
									<span className="w-16 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
										{org.memberCount}
									</span>
									<span className="w-14 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
										{org.repoCount}
									</span>
									<span className="hidden w-24 shrink-0 text-muted-foreground text-xs md:block">
										{formatAdminDate(org.createdAt)}
									</span>
								</button>
								{expandedOrgId === org.id ? (
									<OrgMembersPanel isPersonal={org.isPersonal} orgId={org.id} />
								) : null}
							</div>
						))}
					</div>
				)}

				<div className="mt-4 flex items-center justify-between text-muted-foreground text-xs">
					<span>
						{total === 0
							? "0 orgs"
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

function OrgMembersPanel({
	orgId,
	isPersonal,
}: {
	orgId: string;
	isPersonal: boolean;
}) {
	const queryClient = useQueryClient();
	const { data: members } = useQuery(adminOrgMembersQueryOptions(orgId));
	const changeRole = useMutation({
		mutationFn: adminUpdateOrgMemberRole,
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: adminQueryKeys.orgMembers(orgId),
			}),
	});

	return (
		<div className="border-t bg-surface-1/50 px-4 py-2">
			{members?.map((m) => (
				<div className="flex items-center gap-2.5 py-1.5" key={m.memberId}>
					{m.image ? (
						<img
							alt=""
							className="size-5 shrink-0 rounded-full"
							crossOrigin="anonymous"
							src={m.image}
						/>
					) : (
						<span className="size-5 shrink-0 rounded-full bg-surface-2" />
					)}
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm">{m.name}</p>
						<p className="truncate text-muted-foreground text-xs">{m.email}</p>
					</div>
					<span className="hidden w-24 shrink-0 text-muted-foreground text-xs sm:block">
						{formatAdminDate(m.joinedAt)}
					</span>
					{/* Personal orgs refuse role changes at the guard; don't offer. */}
					{isPersonal ? (
						<span className="text-muted-foreground text-xs">{m.role}</span>
					) : (
						<select
							className="h-7 rounded-md border bg-card px-2 text-xs"
							disabled={changeRole.isPending}
							onChange={(e) =>
								changeRole.mutate(
									{
										data: {
											memberId: m.memberId,
											role: e.target.value as OrgRole,
										},
									},
									{
										onSuccess: (result) => {
											toast(
												result.ok
													? "role saved"
													: (result.error ?? "role change refused"),
											);
										},
									},
								)
							}
							value={m.role}
						>
							<option value="admin">admin</option>
							<option value="member">member</option>
						</select>
					)}
				</div>
			))}
		</div>
	);
}
