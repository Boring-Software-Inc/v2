import { createDb, economicsServices } from "@tripwire/db";
import pino from "pino";
import { economicsDigest, postMonthlyReport } from "./jobs/economics-digest.ts";
import {
	previousUtcDay,
	pullProviderCosts,
} from "./jobs/pull-provider-costs.ts";

/**
 * Manual economics cron trigger. The three jobs normally run on pg-boss
 * schedules (pull 01:40, rollup 02:20, digest 02:30 UTC). This runs any of them
 * NOW, in-process, against the configured database — useful right after the
 * migration + backfill land, or to re-roll a specific past day.
 *
 *   bun --env-file=.env.production run apps/worker/src/economics-trigger.ts <cmd> [--day YYYY-MM-DD]
 *
 * cmd:
 *   backfill  one-time ai_review_usage backfill from stored traces
 *   pull      pull provider invoices into provider_costs_daily
 *   rollup    roll a day into economics_daily (drift, credit, reconciliation)
 *   digest    post the Discord digest + alerts (monthly report if the day is a
 *             month end); needs ECONOMICS_WEBHOOK_URL or FEEDBACK_WEBHOOK_URL
 *   report    post the long-form monthly report for the target day's month
 *   all       pull, then rollup, then digest for the target day
 *
 * --day defaults to yesterday UTC (the day a 01:40 cron would target).
 * --dry-run prints the digest/report instead of posting to Discord. Use it for
 *   local runs: the digest posts to the REAL webhook in .env otherwise.
 */

const COMMANDS = [
	"backfill",
	"pull",
	"rollup",
	"digest",
	"report",
	"all",
] as const;
type Command = (typeof COMMANDS)[number];

function parseArgs(argv: string[]): {
	cmd: Command;
	day: string;
	dryRun: boolean;
} {
	const cmd = argv[2] as Command | undefined;
	if (!cmd || !COMMANDS.includes(cmd)) {
		process.stderr.write(
			`usage: economics-trigger <${COMMANDS.join("|")}> [--day YYYY-MM-DD] [--dry-run]\n`,
		);
		process.exit(2);
	}
	const dayFlag = argv.indexOf("--day");
	const day =
		dayFlag !== -1 && argv[dayFlag + 1]
			? (argv[dayFlag + 1] as string)
			: previousUtcDay(new Date());
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
		process.stderr.write(`invalid --day "${day}", expected YYYY-MM-DD\n`);
		process.exit(2);
	}
	return { cmd, day, dryRun: argv.includes("--dry-run") };
}

/** A Date whose previousUtcDay is `day`, so the day-targeting jobs hit it. */
function nowForDay(day: string): Date {
	const d = new Date(`${day}T12:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d;
}

const { cmd, day, dryRun } = parseArgs(process.argv);
const logger = pino({ name: "economics-trigger" });
const { db, pool } = createDb();

/** In dry-run, print what the digest would post instead of hitting Discord. */
const dryPost = dryRun
	? (_url: string, body: unknown) => {
			const content = (body as { content?: string }).content ?? "";
			process.stdout.write(
				`\n--- digest (dry-run, not posted) ---\n${content}\n`,
			);
			return Promise.resolve({ ok: true });
		}
	: undefined;

try {
	if (cmd === "backfill") {
		const result = await economicsServices.backfillAiReviewUsage(db);
		logger.info(result, "backfill complete");
	}
	if (cmd === "pull" || cmd === "all") {
		await pullProviderCosts({ db, logger, now: nowForDay(day) });
	}
	if (cmd === "rollup" || cmd === "all") {
		const result = await economicsServices.rollupEconomicsDay(db, day);
		logger.info(result, "rollup complete");
	}
	if (cmd === "digest" || cmd === "all") {
		await economicsDigest({
			db,
			logger,
			now: nowForDay(day),
			postImpl: dryPost,
		});
	}
	if (cmd === "report") {
		// The long-form monthly report for the target day's month.
		await postMonthlyReport({ db, logger, postImpl: dryPost }, day.slice(0, 7));
	}
	logger.info({ cmd, day }, "economics trigger done");
} finally {
	await pool.end();
}
