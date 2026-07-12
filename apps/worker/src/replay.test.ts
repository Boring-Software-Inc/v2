import { describe, expect, test } from "bun:test";
import { parseCorpus, replay } from "./jobs/replay.ts";

/**
 * §11 verdict replay over the committed corpus (captured live scratch runs).
 * The corpus was decided under PRE-unit-1/unit-5 semantics, so the current
 * engine derives exactly two explainable flips. A future core change that
 * alters this report is the review moment — update the expectations here
 * only after a human has read the flip report.
 */
describe("verdict replay — committed corpus", () => {
	test("replays without crash and derives exactly the two explained flips", async () => {
		const bundles = parseCorpus(
			await Bun.file(
				new URL("../fixtures/replay-corpus.json", import.meta.url).pathname,
			).json(),
		);
		const report = await replay(bundles);

		expect(report.total).toBe(bundles.length);
		expect(report.skipped).toHaveLength(0);
		expect(report.unchanged + report.flips.length).toBe(report.total);

		const flips = new Map(report.flips.map((f) => [f.runId, f]));
		expect(flips.size).toBe(2);

		const t2a = flips.get("019f538a-926f-7000-87c7-e9cd3d79c80a");
		expect(t2a?.oldVerdict).toBe("pass");
		expect(t2a?.newVerdict).toBe("block");
		expect(t2a?.responsible).toContain("gate reachability");

		const t4 = flips.get("019f54d3-0c13-7000-930a-dc97f87e1d5e");
		expect(t4?.oldVerdict).toBe("pass");
		expect(t4?.newVerdict).toBe("block");
		expect(t4?.responsible).toContain("deny-floor");

		for (const flip of report.flips) {
			expect(flip.responsible).not.toContain("UNATTRIBUTED");
		}
	});
});
