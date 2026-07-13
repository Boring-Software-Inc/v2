/**
 * `bun run smoke:deploy` — post-cutover HTTP smoke of the two surfaces this
 * whole deploy exists to fix: the PR-comment BADGE IMAGE and the PUBLIC RUN
 * PAGE. When `APP_URL` was `localhost`, the badge rendered as alt text and the
 * run link was unreachable for every blocked contributor (dither-kit#8). This
 * asserts they resolve over the public internet, exiting non-zero on failure.
 *
 * This is the MECHANICAL half. The owner still eyeballs that the badge visually
 * renders in the PR and that the run page READS right (plain-English summaries,
 * ai-review findings, no raw trace, no thresholds) — those are taste, not HTTP.
 * The PR flow itself (check fails on head SHA, one @-mention comment naming the
 * rule, supersede + resolution + review dismissal on the fix) is asserted by
 * `bun run test:lifecycle` against real GitHub state.
 *
 *   APP_URL       the real public web URL (required) — same value the worker uses.
 *   SMOKE_RUN_ID  a real run id to fetch the public run page (optional; from the
 *                 smoke PR's comment link). Skipped with a warning if unset.
 */
const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
if (!appUrl) {
	process.stderr.write("\n✗ APP_URL is not set (the real public web URL).\n");
	process.exit(1);
}
const runId = process.env.SMOKE_RUN_ID;

let failed = false;
function pass(msg: string): void {
	process.stdout.write(`   ✓ ${msg}\n`);
}
function bad(msg: string): void {
	failed = true;
	process.stderr.write(`   ✗ ${msg}\n`);
}

/** 1 — the badge PNG must be a real image, not a 404/alt-text. */
async function checkBadge(): Promise<void> {
	const url = `${appUrl}/badges/view-run.png`;
	process.stdout.write(`\n1. badge image — ${url}\n`);
	try {
		const res = await fetch(url, { redirect: "manual" });
		const type = res.headers.get("content-type") ?? "";
		const body = await res.arrayBuffer();
		if (res.status !== 200) {
			bad(
				`status ${res.status} (want 200) — the badge would render as alt text`,
			);
			return;
		}
		if (!type.startsWith("image/")) {
			bad(`content-type "${type}" (want image/*)`);
			return;
		}
		if (body.byteLength === 0) {
			bad("empty body");
			return;
		}
		pass(`200 ${type}, ${body.byteLength} bytes`);
	} catch (error) {
		bad(`request failed: ${error instanceof Error ? error.message : error}`);
	}
}

/** 2 — the public run page must resolve with NO session and carry the footer. */
async function checkPublicRunPage(): Promise<void> {
	if (!runId) {
		process.stdout.write(
			"\n2. public run page — SKIPPED (set SMOKE_RUN_ID to a real run id)\n",
		);
		return;
	}
	const url = `${appUrl}/runs/${runId}`;
	process.stdout.write(`\n2. public run page (no session) — ${url}\n`);
	try {
		// No cookie header, manual redirect: a bounce to /login means the public
		// stranger view is gated and a blocked contributor would hit a wall.
		const res = await fetch(url, { redirect: "manual", headers: {} });
		if (res.status >= 300 && res.status < 400) {
			bad(
				`redirect to ${res.headers.get("location") ?? "?"} — the run page is ` +
					"session-gated; a signed-out contributor can't see it",
			);
			return;
		}
		if (res.status !== 200) {
			bad(`status ${res.status} (want 200)`);
			return;
		}
		const html = await res.text();
		if (!html.toLowerCase().includes("powered by tripwire")) {
			bad(
				'missing the "powered by tripwire" footer (public projection marker)',
			);
			return;
		}
		pass('200, unauthenticated, "powered by tripwire" footer present');
	} catch (error) {
		bad(`request failed: ${error instanceof Error ? error.message : error}`);
	}
}

async function main(): Promise<void> {
	await checkBadge();
	await checkPublicRunPage();
	if (failed) {
		process.stderr.write(
			"\n✗ deploy smoke FAILED — the badge and/or public run page are the " +
				"whole point of this deploy. Do not consider the cutover done.\n",
		);
		process.exit(1);
	}
	process.stdout.write(
		"\n✓ deploy smoke passed (badge + public run page resolve).\n",
	);
	process.exit(0);
}

void main();
