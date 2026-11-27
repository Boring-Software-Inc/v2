import { expect, test } from "bun:test";
import pino from "pino";
import { startIngestDropTally } from "./ingest-drops.ts";

test("drops are logged once per interval, grouped by event and reason", () => {
	const lines: string[] = [];
	const tally = startIngestDropTally(
		pino({ level: "info" }, { write: (chunk: string) => lines.push(chunk) }),
	);
	tally.add("unsubscribed", "check_suite");
	tally.add("unsubscribed", "check_suite");
	tally.add("unlinked-installation", "pull_request");
	tally.flush();
	tally.flush();
	tally.stop();

	expect(lines).toHaveLength(1);
	expect(JSON.parse(lines[0] ?? "{}").counts).toEqual({
		"check_suite:unsubscribed": 2,
		"pull_request:unlinked-installation": 1,
	});
});
