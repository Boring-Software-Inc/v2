import { expect, test } from "bun:test";
import { GITCAFE_RECEIPT_APP_ID } from "@tripwire/contracts";
import { normalizeFor } from "./forge-runtime.ts";
import { workerModeSchema } from "./gitcafe-connection-worker.ts";
import { gitCafeLifecycleWorkerEnvSchema } from "./gitcafe-lifecycle-worker.ts";

test("receipt consumer is a separate preview-only mode without app credential requirements", () => {
	const env = {
		UNKEY_ENVIRONMENT_SLUG: "preview",
		GITCAFE_APP_ID: GITCAFE_RECEIPT_APP_ID,
		DATABASE_URL: "postgres://test:test@localhost/test",
		GITCAFE_WEBHOOK_RECEIPTS_ENABLED: "true",
	};
	const parsed = gitCafeLifecycleWorkerEnvSchema.parse(env);
	expect(parsed.PORT).toBe(8181);
	for (const change of [
		{ UNKEY_ENVIRONMENT_SLUG: "production" },
		{ GITCAFE_APP_ID: "wrong-app" },
		{ PORT: 3000 },
		{ GITCAFE_WEBHOOK_RECEIPTS_ENABLED: "false" },
		{ GITCAFE_WEBHOOK_RECEIPTS_ENABLED: undefined },
	])
		expect(
			gitCafeLifecycleWorkerEnvSchema.safeParse({ ...env, ...change }).success,
		).toBe(false);
	expect(workerModeSchema.parse("gitcafe-lifecycle")).toBe("gitcafe-lifecycle");
	expect(normalizeFor("gitcafe")).toBeNull();
});
