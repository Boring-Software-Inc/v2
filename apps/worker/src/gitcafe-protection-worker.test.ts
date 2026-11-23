import { expect, test } from "bun:test";
import { runsGitCafeProtectionQueues } from "./gitcafe-protection-worker.ts";

test("only the canonical preview branch consumes GitCafe protection queues", () => {
	expect(
		runsGitCafeProtectionQueues({
			UNKEY_ENVIRONMENT_SLUG: "preview",
			UNKEY_GIT_BRANCH: "staging",
		}),
	).toBe(true);
	expect(
		runsGitCafeProtectionQueues({
			UNKEY_ENVIRONMENT_SLUG: "preview",
			UNKEY_GIT_BRANCH: "codex/gitcafe-fix",
		}),
	).toBe(false);
});

test("production and local workers continue to consume protection queues", () => {
	expect(
		runsGitCafeProtectionQueues({
			UNKEY_ENVIRONMENT_SLUG: "production",
			UNKEY_GIT_BRANCH: "main",
		}),
	).toBe(true);
	expect(runsGitCafeProtectionQueues({})).toBe(true);
});

test("the canonical protection branch can be configured", () => {
	expect(
		runsGitCafeProtectionQueues({
			UNKEY_ENVIRONMENT_SLUG: "preview",
			UNKEY_GIT_BRANCH: "release",
			GITCAFE_PROTECTION_BRANCH: "release",
		}),
	).toBe(true);
});
