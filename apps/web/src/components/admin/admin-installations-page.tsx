import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { Button } from "#/components/glaze/ui/button";
import { PaginationInfo } from "#/components/glaze/ui/pagination";
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
import {
	ADMIN_PAGE_SIZE,
	adminInstallationsQueryOptions,
} from "#/lib/admin.query";

const COLUMN_COUNT = 4;

export function AdminInstallationsPage() {
	const [offset, setOffset] = useState(0);
	const { data, isLoading, error, refetch } = useQuery(
		adminInstallationsQueryOptions({ offset }),
	);

	const installations = data?.installations ?? [];
	const total = data?.total ?? 0;

	const footer = (
		<>
			{total === 0 ? (
				<span>0 installations</span>
			) : (
				<PaginationInfo
					from={offset + 1}
					noun="installations"
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
						<h1 className="type-title">Installations</h1>
						<p className="type-body text-text-2">
							Every account the app is installed on.
						</p>
					</header>

					<Table
						aria-busy={isLoading || undefined}
						aria-label="Installations"
						footer={footer}
					>
						<TableHeader>
							<TableRow>
								<TableHead>Account</TableHead>
								<TableHead>Org</TableHead>
								<TableHead numeric>Repos</TableHead>
								<TableHead numeric>Protected</TableHead>
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
									art={<MascotArt mood="admin-table-empty" size="compact" />}
									colSpan={COLUMN_COUNT}
									description="Installations show up here when someone installs the app."
									reason="empty"
									title="No installations yet"
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
								/>
							) : (
								installations.map((row) => (
									<TableRow key={`${row.forge}-${row.installationId}`}>
										<TableCell>
											<span className="flex min-w-0 items-center gap-2">
												<ForgeMark
													className="size-(--icon-sm) shrink-0 text-text-2"
													forge={row.forge}
												/>
												<span className="flex min-w-0 flex-col">
													<span className="truncate type-label">
														{row.accountLogin ?? "Unknown account"}
													</span>
													<span className="truncate mono type-caption text-text-2">
														{row.installationId}
													</span>
												</span>
											</span>
										</TableCell>
										<TableCell
											className="text-text-2"
											mono={row.orgSlug !== null}
										>
											{row.orgSlug ?? "Not claimed"}
										</TableCell>
										<TableCell numeric>{row.repoCount}</TableCell>
										<TableCell numeric>{row.protectedRepoCount}</TableCell>
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
