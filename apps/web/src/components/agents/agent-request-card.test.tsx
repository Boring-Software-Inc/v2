import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AgentRequestCard,
	initialOrgPick,
} from "#/components/agents/agent-request-card";
import type { AgentRequestOrg } from "#/lib/agents.functions";

function org(id: string): AgentRequestOrg {
	return { id, slug: id, name: id, isPersonal: false, avatarHue: null };
}

const ORGS = [org("comp"), org("opengit"), org("tripwire")];

function render(orgs: AgentRequestOrg[], activeOrgId: string | null) {
	return renderToStaticMarkup(
		<AgentRequestCard
			activeOrgId={activeOrgId}
			lead={null}
			onDecide={async () => undefined}
			orgs={orgs}
			scopes={[]}
			subtitle="s"
			title="t"
		/>,
	);
}

function allowDisabled(html: string): boolean {
	const button = html
		.split("<button")
		.find((part) => part.includes(">Allow</span>"));
	const tag = button?.slice(0, button.indexOf(">")) ?? "";
	return / disabled=""/.test(tag) || / data-disabled=""/.test(tag);
}

function checkedOrgs(html: string): string[] {
	return [...html.matchAll(/<input id="agent-org-([^"]+)"[^>]*>/g)]
		.filter((match) => match[0].includes('checked=""'))
		.map((match) => match[1] ?? "");
}

describe("initialOrgPick", () => {
	test("picks the org the user is on", () => {
		expect(initialOrgPick(ORGS, "tripwire")).toEqual(["tripwire"]);
	});

	test("picks the only org", () => {
		expect(initialOrgPick([org("solo")], null)).toEqual(["solo"]);
	});

	test("picks nothing when the active org is unknown and there are several", () => {
		expect(initialOrgPick(ORGS, null)).toEqual([]);
		expect(initialOrgPick(ORGS, "gone")).toEqual([]);
	});
});

describe("AgentRequestCard", () => {
	test("Allow is disabled while no org is picked", () => {
		const html = render(ORGS, null);
		expect(checkedOrgs(html)).toEqual([]);
		expect(allowDisabled(html)).toBe(true);
	});

	test("Allow is enabled when the active org is preselected", () => {
		const html = render(ORGS, "tripwire");
		expect(checkedOrgs(html)).toEqual(["tripwire"]);
		expect(allowDisabled(html)).toBe(false);
	});
});
