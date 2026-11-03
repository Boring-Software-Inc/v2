import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AdminPagination } from "#/components/admin/admin-pagination";
import { ForgeMark } from "#/components/common/forge-marks";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
import { Button } from "#/design-system/ui/button";
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
import { CodeText, Label } from "#/design-system/ui/typography";
import { adminInstallationsQueryOptions } from "#/lib/admin.query";

const COLUMN_COUNT = 4;

export function AdminInstallationsPage() {
	const [offset, setOffset] = useState(0);
	const { data, isLoading, error, refetch } = useQuery(
		adminInstallationsQueryOptions({ offset }),
	);

	const installations = data?.installations ?? [];
	const total = data?.total ?? 0;

	return (
		<DashboardLayout counts={{}}>
			<Page>
				<PageHeader
					description="Every forge account where the Tripwire app is installed."
					title="Installations"
				/>
				<PageBody>
					<Table
						aria-busy={isLoading || undefined}
						aria-label="Installations"
						data-admin-table="installations"
						footer={
							<AdminPagination
								noun="installations"
								offset={offset}
								onOffsetChange={setOffset}
								total={total}
							/>
						}
					>
						<TableHeader>
							<TableRow>
								<TableHead>Account</TableHead>
								<TableHead data-admin-column="installation-org">Org</TableHead>
								<TableHead data-admin-column="installation-repos" numeric>
									Repos
								</TableHead>
								<TableHead data-admin-column="installation-protected" numeric>
									Protected
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableLoading
									columns={[{}, {}, { numeric: true }, { numeric: true }]}
								/>
							) : error ? (
								<TableEmpty
									action={
										<Button
											onClick={() => void refetch()}
											size="sm"
											variant="secondary"
										>
											Load installations again
										</Button>
									}
									colSpan={COLUMN_COUNT}
									description={error.message}
									reason="error"
									title="Tripwire couldn't load installations"
								/>
							) : installations.length === 0 ? (
								<TableEmpty
									action={
										<Button
											nativeButton={false}
											render={<Link to="/admin/orgs" />}
											size="sm"
											variant="secondary"
										>
											View orgs
										</Button>
									}
									art={<MascotArt mood="admin-table-empty" size="compact" />}
									colSpan={COLUMN_COUNT}
									description="Installations appear after someone installs the app on a forge account."
									reason="empty"
									title="No installations yet"
								/>
							) : (
								installations.map((row) => (
									<TableRow key={`${row.forge}-${row.installationId}`}>
										<TableCell>
											<span data-layout-role="admin-forge-account">
												<ForgeMark forge={row.forge} />
												<span>
													<Label>{row.accountLogin ?? "Unknown account"}</Label>
													<CodeText as="span">{row.installationId}</CodeText>
												</span>
											</span>
										</TableCell>
										<TableCell
											data-admin-column="installation-org"
											mono={row.orgSlug !== null}
										>
											{row.orgSlug ?? "Not claimed"}
										</TableCell>
										<TableCell data-admin-column="installation-repos" numeric>
											{row.repoCount}
										</TableCell>
										<TableCell
											data-admin-column="installation-protected"
											numeric
										>
											{row.protectedRepoCount}
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
