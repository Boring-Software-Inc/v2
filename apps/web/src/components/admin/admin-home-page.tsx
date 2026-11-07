import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AdminBlocklistForm } from "#/components/admin/admin-blocklist-form";
import { AdminOverviewStats } from "#/components/admin/admin-overview-stats";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import {
	Section,
	SectionBody,
	SectionHeader,
} from "#/components/layouts/section";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "#/design-system/ui/alert";
import { Button } from "#/design-system/ui/button";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/design-system/ui/item";
import { adminOverviewQueryOptions } from "#/lib/admin.query";

const SECTIONS = [
	{
		to: "/admin/users",
		title: "Users",
		description: "Review beta access and manage individual account controls.",
	},
	{
		to: "/admin/orgs",
		title: "Orgs",
		description: "Inspect every org, its members and member roles.",
	},
	{
		to: "/admin/repos",
		title: "Repos",
		description:
			"Check connected repos and whether Tripwire is protecting them.",
	},
	{
		to: "/admin/installations",
		title: "Installations",
		description: "See installed forge accounts and which org claimed each one.",
	},
] as const;

export function AdminHomePage() {
	const { data, error, refetch, isFetching } = useQuery(
		adminOverviewQueryOptions(),
	);

	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<PageHeader
					description={
						data
							? `${data.pendingUsers} ${data.pendingUsers === 1 ? "user is" : "users are"} waiting for access.`
							: "Platform access and connected resources."
					}
					title="Admin"
				/>
				<PageBody>
					{error ? (
						<Alert status="fail">
							<AlertTitle>Tripwire couldn't load the admin summary</AlertTitle>
							<AlertDescription>{error.message}</AlertDescription>
							<AlertAction>
								<Button
									disabled={isFetching}
									onClick={() => void refetch()}
									size="sm"
									variant="secondary"
								>
									Load summary again
								</Button>
							</AlertAction>
						</Alert>
					) : null}

					<Section id="admin-summary">
						<SectionHeader title="Product at a glance" />
						<SectionBody>
							<AdminOverviewStats overview={data} />
						</SectionBody>
					</Section>

					<AdminBlocklistForm />

					<Section id="admin-sections">
						<SectionHeader title="Staff tools" />
						<SectionBody>
							<ItemGroup aria-label="Admin sections">
								{SECTIONS.map((section) => (
									<Item key={section.to}>
										<ItemContent>
											<ItemTitle>
												<Link
													data-layout-role="admin-section-link"
													to={section.to}
												>
													{section.title}
												</Link>
											</ItemTitle>
											<ItemDescription>{section.description}</ItemDescription>
										</ItemContent>
									</Item>
								))}
							</ItemGroup>
						</SectionBody>
					</Section>
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
