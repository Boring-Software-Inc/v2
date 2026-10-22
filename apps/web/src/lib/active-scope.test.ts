import { describe, expect, test } from "bun:test";
import type { OrgWithRole } from "@tripwire/db";
import { resolveActiveScope, runRouteScope } from "#/lib/active-scope";

function org(slug: string, isPersonal = false): OrgWithRole {
	return {
		id: `id-${slug}`,
		slug,
		name: slug,
		isPersonal,
		avatarHue: 0,
		role: "member",
	};
}

const comp = org("comp", true);
const boring = org("boring-software-inc");
const orgs = [comp, boring];

describe("resolveActiveScope", () => {
	test("the URL org wins, with its repo", () => {
		expect(
			resolveActiveScope({
				orgs,
				urlOrg: "boring-software-inc",
				urlRepo: "scratch",
				routeScope: { org: "comp", repo: "other" },
				defaultOrgSlug: "comp",
			}),
		).toEqual({ org: boring, repoCandidate: "scratch" });
	});

	test("a run route scope places a member in the run's org and repo", () => {
		expect(
			resolveActiveScope({
				orgs,
				urlOrg: undefined,
				urlRepo: undefined,
				routeScope: { org: "boring-software-inc", repo: "scratch" },
				defaultOrgSlug: "comp",
			}),
		).toEqual({ org: boring, repoCandidate: "scratch" });
	});

	test("a route scope outside the viewer's orgs falls back to the last active org", () => {
		expect(
			resolveActiveScope({
				orgs: [comp, boring],
				urlOrg: undefined,
				urlRepo: undefined,
				routeScope: { org: "someone-else", repo: "secret" },
				defaultOrgSlug: "boring-software-inc",
			}),
		).toEqual({ org: boring, repoCandidate: null });
	});

	test("no route scope keeps the last active org, not the first in the list", () => {
		expect(
			resolveActiveScope({
				orgs,
				urlOrg: undefined,
				urlRepo: undefined,
				routeScope: null,
				defaultOrgSlug: "boring-software-inc",
			}),
		).toEqual({ org: boring, repoCandidate: null });
	});

	test("a URL org the viewer does not belong to never leaks its repo", () => {
		expect(
			resolveActiveScope({
				orgs,
				urlOrg: "someone-else",
				urlRepo: "secret",
				routeScope: null,
				defaultOrgSlug: "comp",
			}),
		).toEqual({ org: comp, repoCandidate: null });
	});

	test("signed out: no orgs, no scope", () => {
		expect(
			resolveActiveScope({
				orgs: undefined,
				urlOrg: undefined,
				urlRepo: undefined,
				routeScope: null,
				defaultOrgSlug: null,
			}),
		).toEqual({ org: null, repoCandidate: null });
	});
});

describe("runRouteScope", () => {
	test("a full run view carries its org and repo", () => {
		expect(
			runRouteScope({ orgSlug: "boring-software-inc", repoName: "scratch" }),
		).toEqual({ org: "boring-software-inc", repo: "scratch" });
	});

	test("a public or missing run carries no scope", () => {
		expect(runRouteScope({ orgSlug: null, repoName: null })).toBeNull();
		expect(runRouteScope(null)).toBeNull();
	});
});
