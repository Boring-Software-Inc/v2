import { expect, test } from "bun:test";
import {
	gitCafeCheckReportResponseSchema,
	gitCafeReportedCheckSchema,
} from "@tripwire/contracts";
import report from "../fixtures/gitcafe-check-neutral.json";
import readback from "../fixtures/gitcafe-check-readback.json";

test("authenticated staging check report agrees with its ownership readback", () => {
	const response = gitCafeCheckReportResponseSchema.parse(report);
	const persisted = gitCafeReportedCheckSchema.parse(readback);
	expect(response.outcome).toBe("created");
	expect(response.checkRun).toEqual(persisted);
	expect(persisted).toMatchObject({
		installationId: "ins_01m60zef0bfzzbx050fw4rymhr",
		reporterId: "act_01m60zef00f4fsqskxqt2w72xs",
		headOid: "2bff66c45a9e2241fc2482bc63bac23281a7377f",
		key: "tripwire-staging-qa",
		name: "tripwire",
		conclusion: "neutral",
	});
});

test("malformed check identity and timestamps fail the response boundary", () => {
	for (const mutation of [
		{ headOid: "main" },
		{ reporterId: "" },
		{ installationId: "" },
		{ reportedAt: "yesterday" },
		{ conclusion: "passing" },
	]) {
		expect(
			gitCafeReportedCheckSchema.safeParse({ ...readback, ...mutation })
				.success,
		).toBe(false);
	}
});
