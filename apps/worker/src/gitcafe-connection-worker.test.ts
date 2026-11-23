import { expect, test } from "bun:test";
import { normalizeFor } from "./forge-runtime.ts";
import {
	gitCafeConnectionWorkerEnvSchema,
	workerModeSchema,
} from "./gitcafe-connection-worker.ts";
import { resolveGitCafeProtectionEnv } from "./gitcafe-protection-worker.ts";
import { GITCAFE_STAGING_APP_ID } from "./jobs/gitcafe-connect.ts";

test("isolated connection mode accepts dedicated preview and production staging apps", () => {
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
	expect(
		gitCafeConnectionWorkerEnvSchema.safeParse({
			...environment,
			UNKEY_ENVIRONMENT_SLUG: "production",
		}).success,
	).toBe(true);
	for (const change of [
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

test("receipt rollout uses the API flag and defaults existing connection mode to disabled", () => {
	const environment = {
		UNKEY_ENVIRONMENT_SLUG: "preview",
		GITCAFE_APP_ID: GITCAFE_STAGING_APP_ID,
		GITCAFE_APP_KEY_ID: "staging-key",
		GITCAFE_APP_PRIVATE_KEY: "test-only-no-key",
		DATABASE_URL: "postgres://test:test@localhost/test",
	};
	expect(
		gitCafeConnectionWorkerEnvSchema.parse(environment)
			.GITCAFE_WEBHOOK_RECEIPTS_ENABLED,
	).toBe("false");
	expect(
		gitCafeConnectionWorkerEnvSchema.parse({
			...environment,
			GITCAFE_WEBHOOK_RECEIPTS_ENABLED: "true",
		}).GITCAFE_WEBHOOK_RECEIPTS_ENABLED,
	).toBe("true");
	expect(
		gitCafeConnectionWorkerEnvSchema.safeParse({
			...environment,
			GITCAFE_WEBHOOK_RECEIPTS_ENABLED: "yes",
		}).success,
	).toBe(false);
});

test("standard worker activation cannot silently omit the GitCafe protection runtime", () => {
	const environment = {
		UNKEY_ENVIRONMENT_SLUG: "preview",
		GITCAFE_APP_ID: GITCAFE_STAGING_APP_ID,
		GITCAFE_APP_KEY_ID: "staging-key",
		GITCAFE_APP_PRIVATE_KEY: "test-only-no-key",
		DATABASE_URL: "postgres://test:test@localhost/test",
		GITCAFE_WEBHOOK_RECEIPTS_ENABLED: "true",
	};
	expect(resolveGitCafeProtectionEnv(environment)?.GITCAFE_APP_ID).toBe(
		GITCAFE_STAGING_APP_ID,
	);
	expect(
		resolveGitCafeProtectionEnv({
			...environment,
			UNKEY_ENVIRONMENT_SLUG: "production",
		})?.GITCAFE_APP_ID,
	).toBe(GITCAFE_STAGING_APP_ID);
	expect(
		resolveGitCafeProtectionEnv({
			...environment,
			GITCAFE_WEBHOOK_RECEIPTS_ENABLED: "false",
		}),
	).toBeNull();
	expect(() =>
		resolveGitCafeProtectionEnv({
			...environment,
			GITCAFE_APP_PRIVATE_KEY: undefined,
		}),
	).toThrow("Invalid staging GitCafe protection worker configuration");
});
