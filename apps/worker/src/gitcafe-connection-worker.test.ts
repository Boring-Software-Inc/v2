import { expect, test } from "bun:test";
import { normalizeFor } from "./forge-runtime.ts";
import {
	gitCafeConnectionWorkerEnvSchema,
	workerModeSchema,
} from "./gitcafe-connection-worker.ts";
import { GITCAFE_STAGING_APP_ID } from "./jobs/gitcafe-connect.ts";

test("isolated connection mode requires actual preview environment and dedicated staging app", () => {
	const environment = {
		UNKEY_ENVIRONMENT_SLUG: "preview",
		GITCAFE_APP_ID: GITCAFE_STAGING_APP_ID,
		GITCAFE_APP_KEY_ID: "staging-key",
		GITCAFE_APP_PRIVATE_KEY: "test-only-no-key",
		DATABASE_URL: "postgres://test:test@localhost/test",
	};
	expect(gitCafeConnectionWorkerEnvSchema.safeParse(environment).success).toBe(
		true,
	);
	for (const change of [
		{ UNKEY_ENVIRONMENT_SLUG: "production" },
		{ UNKEY_ENVIRONMENT_SLUG: "staging" },
		{ GITCAFE_APP_ID: "another-app" },
		{ PORT: 3000 },
		{ GITCAFE_APP_PRIVATE_KEY: undefined },
	])
		expect(
			gitCafeConnectionWorkerEnvSchema.safeParse({ ...environment, ...change })
				.success,
		).toBe(false);
	expect(workerModeSchema.parse("gitcafe-connect")).toBe("gitcafe-connect");
	expect(workerModeSchema.safeParse("connections").success).toBe(false);
	expect(normalizeFor("gitcafe")).toBeNull();
});
