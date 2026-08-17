import { describe, expect, test } from "bun:test";
import { createProjectHook, listMaintainedProjects } from "./onboarding.ts";

/**
 * Unit coverage for the onboarding client — a stub fetch stands in for GitLab so
 * the test pins the request shape and the field mapping. Real project/hook
 * payloads still arrive through `/capture-fixture`; do not hand-write those.
 */

function stubFetch(
	handler: (url: string, init: RequestInit | undefined) => Response,
): typeof fetch {
	return ((input: string | URL | Request, init?: RequestInit) =>
		Promise.resolve(handler(String(input), init))) as typeof fetch;
}

describe("listMaintainedProjects", () => {
	test("requests maintainer-access projects and maps namespace/name", async () => {
		let seenUrl = "";
		const fetchImpl = stubFetch((url) => {
			seenUrl = url;
			return new Response(
				JSON.stringify([
					{
						id: 42,
						path: "api",
						path_with_namespace: "acme/team/api",
						visibility: "private",
					},
				]),
				{ status: 200 },
			);
		});

		const projects = await listMaintainedProjects({
			token: "t0ken",
			fetchImpl,
		});

		expect(seenUrl).toContain("min_access_level=40");
		expect(seenUrl).toContain("membership=true");
		expect(projects).toEqual([
			{
				externalId: "42",
				owner: "acme/team",
				name: "api",
				fullName: "acme/team/api",
				private: true,
			},
		]);
	});
});

describe("createProjectHook", () => {
	test("posts the tripwire event set with the secret token", async () => {
		let seenUrl = "";
		let seenBodyRaw = "";
		const fetchImpl = stubFetch((url, init) => {
			seenUrl = url;
			seenBodyRaw = String(init?.body);
			return new Response(JSON.stringify({ id: 7 }), { status: 201 });
		});

		const result = await createProjectHook(
			{ token: "t0ken", fetchImpl },
			{
				projectId: "42",
				url: "https://app.tripwire.sh/webhooks/gitlab",
				secret: "s3cret",
			},
		);

		expect(seenUrl).toContain("/projects/42/hooks");
		expect(JSON.parse(seenBodyRaw)).toMatchObject({
			url: "https://app.tripwire.sh/webhooks/gitlab",
			token: "s3cret",
			merge_requests_events: true,
			note_events: true,
			push_events: true,
			enable_ssl_verification: true,
		});
		expect(result).toEqual({ externalId: "7" });
	});
});
