import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { OrgRole } from "@tripwire/contracts";
import { useId, useState } from "react";
import { AdminPagination } from "#/components/admin/admin-pagination";
import { formatAdminDate } from "#/components/admin/format-admin-date";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { ChevronDown, ChevronRight, Icon } from "#/design-system/icon";
import { Avatar } from "#/design-system/ui/avatar";
import { Button } from "#/design-system/ui/button";
import { FilterBar, FilterBarSearch } from "#/design-system/ui/filter-bar";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemMeta,
	ItemTitle,
} from "#/design-system/ui/item";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/design-system/ui/segmented-control";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/design-system/ui/select";
import { SkeletonText } from "#/design-system/ui/skeleton";
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
import { CodeText, Label, SupportingText } from "#/design-system/ui/typography";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { adminUpdateOrgMemberRole } from "#/lib/admin.functions";
import {
	adminOrgMembersQueryOptions,
	adminOrgsQueryOptions,
	adminQueryKeys,
} from "#/lib/admin.query";
import { ADMIN_ORG_KINDS } from "#/lib/admin-search";
import { pickValue } from "#/lib/pick-value";

const routeApi = getRouteApi("/admin/orgs");

const KIND_FILTERS = [
	{ key: "all", label: "All" },
	{ key: "team", label: "Team" },
	{ key: "personal", label: "Personal" },
] as const;

const ROLE_ITEMS = [
	{ value: "admin", label: "Admin" },
	{ value: "member", label: "Member" },
];

const COLUMN_COUNT = 5;

export function AdminOrgsPage() {
	const { kind } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();
	const [search, setSearch] = useState("");
	const [offset, setOffset] = useState(0);
	const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
	const debouncedSearch = useDebouncedValue(search, 250);
	const panelIdBase = useId();

	const { data, isLoading, error, refetch } = useQuery(
		adminOrgsQueryOptions({
			kind: kind === "all" ? undefined : kind,
			search: debouncedSearch || undefined,
			offset,
		}),
	);

	const orgs = data?.orgs ?? [];
	const total = data?.total ?? 0;
	const filtered = kind !== "all" || debouncedSearch !== "";

	const setKind = (value: string) => {
		const next = pickValue(ADMIN_ORG_KINDS, value);
		if (!next) {
			return;
		}
		setOffset(0);
		setExpandedOrgId(null);
		void navigate({
			search: (prev) => ({ ...prev, kind: next }),
			replace: true,
			resetScroll: false,
		});
	};

	const clearFilters = () => {
		setSearch("");
		setKind("all");
	};

	return (
		<DashboardLayout counts={{}}>
			<Page>
				<PageHeader
					description="Open an org to inspect its members and change team roles."
					title="Orgs"
				/>
				<PageBody>
					<Table
						aria-busy={isLoading || undefined}
						aria-label="Orgs"
						data-admin-table="orgs"
						footer={
							<AdminPagination
								noun="orgs"
								offset={offset}
								onOffsetChange={(next) => {
									setExpandedOrgId(null);
									setOffset(next);
								}}
								total={total}
							/>
						}
						toolbar={
							<FilterBar aria-label="Filter orgs">
								<SegmentedControl
									aria-label="Org kind"
									onValueChange={setKind}
									size="sm"
									value={kind}
								>
									{KIND_FILTERS.map((filter) => (
										<SegmentedControlItem key={filter.key} value={filter.key}>
											{filter.label}
										</SegmentedControlItem>
									))}
								</SegmentedControl>
								<FilterBarSearch
									aria-label="Search orgs"
									onValueChange={(value) => {
										setSearch(value);
										setOffset(0);
										setExpandedOrgId(null);
									}}
									placeholder="Name or slug"
									value={search}
								/>
							</FilterBar>
						}
					>
						<TableHeader>
							<TableRow>
								<TableHead>Org</TableHead>
								<TableHead>Kind</TableHead>
								<TableHead numeric>Members</TableHead>
								<TableHead data-admin-column="org-repos" numeric>
									Repos
								</TableHead>
								<TableHead data-admin-column="org-created">Created</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableLoading
									columns={[{}, {}, { numeric: true }, { numeric: true }, {}]}
								/>
							) : error ? (
								<TableEmpty
									action={
										<Button
											onClick={() => void refetch()}
											size="sm"
											variant="secondary"
										>
											Load orgs again
										</Button>
									}
									colSpan={COLUMN_COUNT}
									description={error.message}
									reason="error"
									title="Tripwire couldn't load orgs"
								/>
							) : orgs.length === 0 ? (
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
												render={<Link to="/admin/users" />}
												size="sm"
												variant="secondary"
											>
												View users
											</Button>
										)
									}
									art={<MascotArt mood="admin-table-empty" size="compact" />}
									colSpan={COLUMN_COUNT}
									description={
										filtered
											? "Try another org kind or search."
											: "Orgs appear when people sign up or create a team."
									}
									reason={filtered ? "no-results" : "empty"}
									title={filtered ? "No orgs match this filter" : "No orgs yet"}
								/>
							) : (
								orgs.flatMap((org) => {
									const expanded = expandedOrgId === org.id;
									const panelId = `${panelIdBase}-${org.id}`;
									const rows = [
										<TableRow key={org.id} open={expanded}>
											<TableCell>
												<div data-layout-role="admin-org-identity">
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
													<span>
														<Label>{org.name}</Label>
														<CodeText as="span">{org.slug}</CodeText>
													</span>
												</div>
											</TableCell>
											<TableCell>
												{org.isPersonal ? "Personal" : "Team"}
											</TableCell>
											<TableCell numeric>{org.memberCount}</TableCell>
											<TableCell data-admin-column="org-repos" numeric>
												{org.repoCount}
											</TableCell>
											<TableCell data-admin-column="org-created">
												{formatAdminDate(org.createdAt)}
											</TableCell>
										</TableRow>,
									];
									if (expanded) {
										rows.push(
											<TableRow key={`${org.id}-members`}>
												<TableCell
													colSpan={COLUMN_COUNT}
													data-layout-role="admin-org-members-cell"
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
				</PageBody>
			</Page>
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
	const {
		data: members,
		isLoading,
		error,
		refetch,
	} = useQuery(adminOrgMembersQueryOptions(orgId));
	const changeRole = useMutation({
		mutationFn: adminUpdateOrgMemberRole,
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: adminQueryKeys.orgMembers(orgId),
			}),
	});

	if (isLoading) {
		return (
			<div aria-busy data-layout-role="admin-org-members-state">
				<span className="sr-only">Loading members of {orgName}</span>
				<SkeletonText data-layout-size="member-row" type="body-sm" />
			</div>
		);
	}
	if (error) {
		return (
			<div data-layout-role="admin-org-members-state">
				<SupportingText>
					Tripwire couldn't load members of {orgName}.
				</SupportingText>
				<Button onClick={() => void refetch()} size="sm" variant="secondary">
					Load members again
				</Button>
			</div>
		);
	}
	if (!members || members.length === 0) {
		return (
			<div data-layout-role="admin-org-members-state">
				<SupportingText>No members are attached to this org.</SupportingText>
			</div>
		);
	}

	return (
		<ItemGroup aria-label={`Members of ${orgName}`} variant="plain">
			{members.map((member) => (
				<Item key={member.memberId} size="sm">
					<ItemMedia>
						<Avatar
							decorative
							name={member.name}
							size="sm"
							src={member.image ?? undefined}
						/>
					</ItemMedia>
					<ItemContent>
						<ItemTitle>{member.name}</ItemTitle>
						<ItemDescription>{member.email}</ItemDescription>
					</ItemContent>
					<ItemMeta>{formatAdminDate(member.joinedAt)}</ItemMeta>
					<ItemActions>
						{isPersonal ? (
							<SupportingText as="span">
								{member.role === "admin" ? "Admin" : "Member"}
							</SupportingText>
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
												memberId: member.memberId,
												role: value as OrgRole,
											},
										},
										{
											onSuccess: (result) => {
												if (result.ok) {
													toast.success(
														`${member.name} is now ${value === "admin" ? "admin" : "member"}`,
													);
													return;
												}
												toast.fail(
													result.error ??
														`Tripwire couldn't change the role for ${member.name}. Try again.`,
												);
											},
											onError: () =>
												toast.fail(
													`Tripwire couldn't change the role for ${member.name}. Try again.`,
												),
										},
									);
								}}
								value={member.role}
							>
								<SelectTrigger aria-label={`Role for ${member.name}`} size="sm">
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
