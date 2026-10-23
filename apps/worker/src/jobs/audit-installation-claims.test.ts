import { describe, expect, test } from "bun:test";
import { unprovenClaimEvent } from "./audit-installation-claims.ts";

describe("unprovenClaimEvent", () => {
	test("is an error tagged with the installation and org slug", () => {
		expect(
			unprovenClaimEvent({
				installationId: "42",
				orgId: "org_1",
				orgSlug: "acme",
				account: "acme-corp",
			}),
		).toEqual({
			level: "error",
			tags: { installation_id: "42", org_slug: "acme" },
			extra: { orgId: "org_1", account: "acme-corp" },
		});
	});
});
