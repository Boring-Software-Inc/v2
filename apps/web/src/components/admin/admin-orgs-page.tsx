import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgRole } from "@tripwire/contracts";
import { useId, useState } from "react";
import { formatAdminDate } from "#/components/admin/format-admin-date";
import { ChevronDown, ChevronRight, Icon } from "#/components/glaze/icon";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Button } from "#/components/glaze/ui/button";
import { Input } from "#/components/glaze/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemMeta,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { PaginationInfo } from "#/components/glaze/ui/pagination";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/glaze/ui/select";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
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
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { adminUpdateOrgMemberRole } from "#/lib/admin.functions";
import {
	ADMIN_PAGE_SIZE,
	adminOrgMembersQueryOptions,
	adminOrgsQueryOptions,
	adminQueryKeys,
} from "#/lib/admin.query";

const KIND_FILTERS = [
	{ key: "all", label: "All" },
	{ key: "team", label: "Team" },
	{ key: "personal", label: "Personal" },
] as const;

type OrgKind = (typeof KIND_FILTERS)[number]["key"];

const ROLE_ITEMS = [
	{ value: "admin", label: "Admin" },
	{ value: "member", label: "Member" },
];

const COLUMN_COUNT = 5;

export function AdminOrgsPage() {
	const [kind, setKind] = useState<OrgKind>("all");
	const [search, setSearch] = useState("");
	const [offset, setOffset] = useState(0);
	const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
	const debouncedSearch = useDebouncedValue(search, 250);
	const panelIdBase = useId();

	const { data, isLoading } = useQuery(
		adminOrgsQueryOptions({
			kind: kind === "all" ? undefined : kind,
			search: debouncedSearch || undefined,
			offset,
		}),
	);

	const orgs = data?.orgs ?? [];
	const total = data?.total ?? 0;

	const toolbar = (
		<>
			<SegmentedControl
				aria-label="Org kind"
				onValueChange={(value) => {
					setKind(value as OrgKind);
					setOffset(0);
				}}
				size="sm"
				value={kind}
			>
				{KIND_FILTERS.map((f) => (
					<SegmentedControlItem key={f.key} value={f.key}>
						{f.label}
					</SegmentedControlItem>
				))}
			</SegmentedControl>
			<Input
				aria-label="Search orgs"
				className="ms-auto w-full sm:w-56"
				mode="search"
				onValueChange={(value) => {
					setSearch(value);
					setOffset(0);
				}}
				placeholder="Name or slug"
				size="sm"
				value={search}
			/>
		</>
	);

	const footer = (
		<>
			{total === 0 ? (
				<span>0 orgs</span>
			) : (
				<PaginationInfo
					from={offset + 1}
					noun="orgs"
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
						<h1 className="type-title">Orgs</h1>
						<p className="type-body text-text-2">
							Every org on the platform. Expand a row to see members and fix
							roles.
						</p>
					</header>

					<Table
						aria-busy={isLoading || undefined}
						aria-label="Orgs"
						footer={footer}
						toolbar={toolbar}
					>
						<TableHeader>
							<TableRow>
								<TableHead>Org</TableHead>
								<TableHead>Kind</TableHead>
								<TableHead numeric>Members</TableHead>
								<TableHead numeric>Repos</TableHead>
								<TableHead>Created</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableLoading
									columns={[{}, {}, { numeric: true }, { numeric: true }, {}]}
								/>
							) : orgs.length === 0 ? (
								<TableEmpty
									colSpan={COLUMN_COUNT}
									reason={
										kind === "all" && !debouncedSearch ? "empty" : "no-results"
									}
									title="No orgs match this filter"
								/>
							) : (
								orgs.flatMap((org) => {
									const expanded = expandedOrgId === org.id;
									const panelId = `${panelIdBase}-${org.id}`;
									const rows = [
										<TableRow key={org.id} open={expanded}>
											<TableCell>
												<div className="flex min-w-0 items-center gap-2">
													<Button
														aria-controls={expanded ? panelId : undefined}
														aria-expanded={expanded}
														aria-label={`${expanded ? "Hide" : "Show"} members of ${org.name}`}
														onClick={() =>
															setExpandedOrgId(expanded ? null : org.id)
														}
														size="icon-sm"
														variant="ghost"
													>
														<Icon
															icon={expanded ? ChevronDown : ChevronRight}
														/>
													</Button>
													<OrgAvatar
														hue={org.avatarHue}
														name={org.name}
														size="sm"
													/>
													<div className="flex min-w-0 flex-col">
														<span className="truncate type-label">
															{org.name}
														</span>
														<span className="truncate mono type-caption text-text-2">
															{org.slug}
														</span>
													</div>
												</div>
											</TableCell>
											<TableCell className="text-text-2">
												{org.isPersonal ? "Personal" : "Team"}
											</TableCell>
											<TableCell numeric>{org.memberCount}</TableCell>
											<TableCell numeric>{org.repoCount}</TableCell>
											<TableCell className="text-text-2">
												{formatAdminDate(org.createdAt)}
											</TableCell>
										</TableRow>,
									];
									if (expanded) {
										rows.push(
											<TableRow key={`${org.id}-members`}>
												<TableCell
													className="whitespace-normal py-1 ps-10"
													colSpan={COLUMN_COUNT}
													id={panelId}
												>
													<OrgMembersPanel
														isPersonal={org.isPersonal}
														orgId={org.id}
														orgName={org.name}
													/>
												</TableCell>
											</TableRow>,
										);
									}
									return rows;
								})
							)}
						</TableBody>
					</Table>
				</div>
			</div>
		</DashboardLayout>
	);
}

function OrgMembersPanel({
	orgId,
	orgName,
	isPersonal,
}: {
	orgId: string;
	orgName: string;
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

	if (!members) {
		return (
			<div aria-busy className="py-2">
				<span className="sr-only">Loading members of {orgName}</span>
				<SkeletonText className="w-48" type="body-sm" />
			</div>
		);
	}

	return (
		<ItemGroup aria-label={`Members of ${orgName}`} variant="plain">
			{members.map((m) => (
				<Item key={m.memberId} size="sm">
					<ItemMedia>
						<Avatar
							decorative
							name={m.name}
							size="sm"
							src={m.image ?? undefined}
						/>
					</ItemMedia>
					<ItemContent>
						<ItemTitle>{m.name}</ItemTitle>
						<ItemDescription>{m.email}</ItemDescription>
					</ItemContent>
					<ItemMeta>{formatAdminDate(m.joinedAt)}</ItemMeta>
					<ItemActions className="me-0">
						{isPersonal ? (
							<span className="type-label-sm text-text-2">
								{m.role === "admin" ? "Admin" : "Member"}
							</span>
						) : (
							<Select
								disabled={changeRole.isPending}
								items={ROLE_ITEMS}
								onValueChange={(value) => {
									if (!value) {
										return;
									}
									changeRole.mutate(
										{
											data: {
												memberId: m.memberId,
												role: value as OrgRole,
											},
										},
										{
											onSuccess: (result) => {
												toast(
													result.ok
														? "Role saved"
														: (result.error ?? "Role change refused"),
												);
											},
										},
									);
								}}
								value={m.role}
							>
								<SelectTrigger aria-label={`Role for ${m.name}`} size="sm">
									<SelectValue />
								</SelectTrigger>
								<SelectContent size="sm">
									{ROLE_ITEMS.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</ItemActions>
				</Item>
			))}
		</ItemGroup>
	);
}
