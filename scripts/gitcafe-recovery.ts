import { readFile } from "node:fs/promises";
import { gitCafeRecoveryRequestSchema } from "@tripwire/contracts";
import { createDb, gitCafeLifecycleServices } from "@tripwire/db";
import pino from "pino";

const logger = pino({ name: "gitcafe-recovery" });
const file = process.argv[2];
const apply = process.argv[3] === "--apply";
if (!file || process.argv.length > 4 || (process.argv[3] && !apply))
	throw new Error(
		"Usage: bun scripts/gitcafe-recovery.ts selection.json [--apply]",
	);
if (process.env.UNKEY_ENVIRONMENT_SLUG !== "preview")
	throw new Error("Recovery requires the explicit preview environment");
const request = gitCafeRecoveryRequestSchema.parse(
	JSON.parse(await readFile(file, "utf8")),
);
if (process.env.GITCAFE_APP_ID !== request.selection.appId)
	throw new Error("Recovery app identity mismatch");
const { db, pool } = createDb();
let boss:
	| Awaited<
			ReturnType<typeof gitCafeLifecycleServices.createGitCafeLifecycleBoss>
	  >
	| undefined;
try {
	const plan = await gitCafeLifecycleServices.planGitCafeReceiptRecovery(
		db,
		request.selection,
	);
	for (const item of plan)
		logger.info(
			{ event: "gitcafe.recovery.plan", requestId: request.requestId, ...item },
			"GitCafe retained receipt inventory",
		);
	if (apply) {
		boss = await gitCafeLifecycleServices.createGitCafeLifecycleBoss(
			process.env.DATABASE_URL ?? "",
			logger,
		);
		for (const item of plan) {
			if (item.classification === "missing") continue;
			const status =
				await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
					db,
					boss,
					item.receiptId,
					request,
				);
			logger.info(
				{
					event: "gitcafe.recovery.applied",
					requestId: request.requestId,
					receiptId: item.receiptId,
					classification: item.classification,
					status,
				},
				"GitCafe retained receipt selection processed",
			);
		}
	}
} finally {
	await boss?.stop({ graceful: false });
	await pool.end();
}
