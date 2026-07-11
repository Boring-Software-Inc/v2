import {
	createBoss,
	createDb,
	PROCESS_EVENT_QUEUE,
	type ProcessEventJob,
} from "@tripwire/db";
import pino from "pino";
import { processEvent } from "./jobs/process-event.ts";

/**
 * @tripwire/worker — pg-boss consumers, where I/O meets the pure core. Request
 * ids (the event id) thread through every log line.
 */
if (import.meta.main) {
	const logger = pino({ name: "worker" });
	const { db, pool } = createDb();
	const boss = await createBoss();

	await boss.work<ProcessEventJob>(PROCESS_EVENT_QUEUE, async (jobs) => {
		for (const job of jobs) {
			await processEvent(
				{ db, pool, logger: logger.child({ eventId: job.data.eventId }) },
				job.data,
			);
		}
	});

	logger.info("worker consuming process-event");
}
