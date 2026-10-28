import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrganizationForgeConnection } from "@tripwire/contracts";
import { renderToString } from "react-dom/server";
import { OrganizationConnectionRow } from "#/components/forges/organization-connection-row";
import { OrganizationConnectionsPage } from "#/components/forges/organization-connections-page";
import { CollapsibleGroup } from "#/components/glaze/ui/collapsible";
import { organizationConnectionsQueryOptions } from "#/lib/connections.query";
import { orgContextQueryOptions } from "#/lib/org.query";

const connection: OrganizationForgeConnection = {
	forge: "gitcafe",
	installations: [
		{
			installationId: "installation-one",
			owner: "boring",
			accountType: "Organization",
		},
	],
	repositories: [
		{
			id: "repo-one",
			fullName: "boring/scratch",
			installationId: "installation-one",
		},
	],
};

function page(canManage: boolean) {
	const client = new QueryClient();
	client.setQueryData(orgContextQueryOptions("team").queryKey, {
		id: "org-team",
		slug: "team",
		name: "Team",
		role: "custom-role",
		isPersonal: false,
		avatarHue: null,
		timezone: null,
		permissions: canManage ? ["connections:manage"] : [],
	});
	client.setQueryData(organizationConnectionsQueryOptions("team").queryKey, [
		connection,
	]);
	const markup = renderToString(
		<QueryClientProvider client={client}>
			<OrganizationConnectionsPage org="team" />
		</QueryClientProvider>,
	);
	client.clear();
	return markup;
}

test("organization managers see installation repositories without an OAuth account or expiry warning", () => {
	const markup = page(true);
	expect(markup).toContain("boring/scratch");
	expect(markup).toContain(
		'aria-label="Disconnect boring/scratch from GitCafe"',
	);
	expect(markup).toContain('aria-expanded="false"');
	expect(markup).toContain("var(--brand-gitcafe)");
	expect(markup).not.toContain("Access expired");
	expect(markup).not.toContain("Reconnect GitCafe");
});

test("a non-manager cannot see cached repository names or disconnect controls", () => {
	const markup = page(false);
	expect(markup).toContain("Ask an admin of this org");
	expect(markup).not.toContain("boring/scratch");
	expect(markup).not.toContain("Disconnect");
	expect(markup).not.toContain("Connect repos");
});

test("empty installation groups are disabled and unknown installation metadata offers no disconnect", () => {
	const empty = renderToString(
		<CollapsibleGroup>
			<OrganizationConnectionRow
				connection={{ ...connection, repositories: [] }}
				onCheckAccess={async () => undefined}
			/>
		</CollapsibleGroup>,
	);
	expect(empty).toContain("0 repos");
	expect(empty).toMatch(/<button[^>]*disabled/);
	const unknown = renderToString(
		<CollapsibleGroup defaultValue={["gitcafe"]}>
			<OrganizationConnectionRow
				connection={{ ...connection, installations: [] }}
				onCheckAccess={async () => undefined}
			/>
		</CollapsibleGroup>,
	);
	expect(unknown).toContain("boring/scratch");
	expect(unknown).not.toContain("Disconnect");
});
