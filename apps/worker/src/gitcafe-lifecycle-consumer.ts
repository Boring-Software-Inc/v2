import {
	GITCAFE_LIFECYCLE_QUEUE,
	gitCafeReceiptJobSchema,
} from "@tripwire/contracts";
import {
	type Db,
	gitCafeInstallationLifecycle,
	gitCafeLifecycleServices,
	gitCafeReceipts,
} from "@tripwire/db";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import type { GitCafeRecoveryMonitor } from "./gitcafe-recovery-monitor.ts";

export function observeGitCafeQueueHealth(boss: PgBoss) {
	const health = {
		healthy: true,
		degrade: () => {
			health.healthy = false;
		},
	};
	boss.on("error", health.degrade);
	boss.on("stopped", health.degrade);
	return health;
}

/** Share receipt consumption between isolated modes without starting another worker or health server. */
export async function registerGitCafeLifecycleConsumer(
	db: Db,
	boss: PgBoss,
	logger: Logger,
	onError: () => void = () => {},
	dispatchRepositoryEvents = false,
	monitor?: GitCafeRecoveryMonitor,
): Promise<void> {
	await db.select().from(gitCafeReceipts).limit(0);
	await db.select().from(gitCafeInstallationLifecycle).limit(0);
	await boss.createQueue(GITCAFE_LIFECYCLE_QUEUE);
	/** The installed supervise(name) API scopes expiry and retention to this queue; global supervision stays disabled. */
	const recover = async () => {
		await boss.supervise(GITCAFE_LIFECYCLE_QUEUE);
		return gitCafeLifecycleServices.recoverPendingGitCafeReceipts(db, boss);
	};
	await (monitor ? monitor.run("lifecycle", recover) : recover());
	let recovering = false;
	const recovery = setInterval(async () => {
		if (recovering) return;
		recovering = true;
		try {
			await (monitor ? monitor.run("lifecycle", recover) : recover());
		} catch {
			onError();
			logger.error(
				{ error: "queue-unavailable" },
				"GitCafe lifecycle recovery unavailable",
			);
		} finally {
			recovering = false;
		}
	}, 30_000);
	recovery.unref();
	monitor?.signal.addEventListener("abort", () => clearInterval(recovery), {
		once: true,
	});
	boss.once("stopped", () => clearInterval(recovery));
	await boss.work<unknown>(
		GITCAFE_LIFECYCLE_QUEUE,
		{ batchSize: 1 },
		async (jobs) => {
			try {
				for (const job of jobs) {
					const parsedJob = gitCafeReceiptJobSchema.safeParse(job.data);
					if (!parsedJob.success)
						throw new Error("Invalid GitCafe lifecycle job");
					const dispatched = dispatchRepositoryEvents
						? await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
								db,
								boss,
								parsedJob.data.receiptId,
							)
						: "lifecycle";
					const status =
						dispatched === "lifecycle"
							? await gitCafeLifecycleServices.processGitCafeReceipt(
									db,
									parsedJob.data.receiptId,
								)
							: dispatched;
					logger.info(
						{
							event: `gitcafe.receipt.${status}`,
							forge: "gitcafe",
							queue: GITCAFE_LIFECYCLE_QUEUE,
							jobId: job.id,
							requestId: parsedJob.data.requestId,
							receiptId: parsedJob.data.receiptId,
							status,
						},
						"GitCafe lifecycle receipt processed",
					);
				}
			} catch (error) {
				onError();
				throw error;
			}
		},
	);
}
