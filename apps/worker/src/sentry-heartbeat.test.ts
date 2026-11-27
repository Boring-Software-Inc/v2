import { expect, test } from "bun:test";
import { startSentryHeartbeat } from "./sentry-heartbeat.ts";

test("only the fence leader checks in, so a dead leader can't hide behind a paused one", () => {
	const slugs: string[] = [];
	const checkIn = ((checkIn: { monitorSlug: string }) => {
		slugs.push(checkIn.monitorSlug);
		return "id";
	}) as Parameters<typeof startSentryHeartbeat>[2];

	startSentryHeartbeat("github-worker", () => false, checkIn)();
	expect(slugs).toEqual([]);

	startSentryHeartbeat("github-worker", () => true, checkIn)();
	expect(slugs).toEqual(["github-worker"]);
});
