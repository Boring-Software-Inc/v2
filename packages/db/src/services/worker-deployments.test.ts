import { describe, expect, test } from "bun:test";
import { electLeader, type WorkerDeploymentRow } from "./worker-deployments.ts";

const NOW = new Date("2026-10-21T12:00:00Z");
const STALE_MS = 45_000;

function row(
	deploymentId: string,
	firstSeenSecondsAgo: number,
	heartbeatSecondsAgo: number,
): WorkerDeploymentRow {
	return {
		deploymentId,
		firstSeenAt: new Date(NOW.getTime() - firstSeenSecondsAgo * 1000),
		lastHeartbeatAt: new Date(NOW.getTime() - heartbeatSecondsAgo * 1000),
	};
}

describe("electLeader", () => {
	test("no rows has no leader", () => {
		expect(electLeader([], NOW, STALE_MS)).toBeNull();
	});

	test("the newest live deployment leads", () => {
		const rows = [row("old", 3600, 5), row("new", 60, 5)];
		expect(electLeader(rows, NOW, STALE_MS)).toBe("new");
	});

	test("a stale newest deployment yields to the older live one", () => {
		const rows = [row("old", 3600, 5), row("new", 60, 120)];
		expect(electLeader(rows, NOW, STALE_MS)).toBe("old");
	});

	test("a heartbeat exactly at the window edge still counts", () => {
		const rows = [row("old", 3600, 5), row("new", 60, 45)];
		expect(electLeader(rows, NOW, STALE_MS)).toBe("new");
	});

	test("all stale has no leader", () => {
		const rows = [row("old", 3600, 300), row("new", 60, 300)];
		expect(electLeader(rows, NOW, STALE_MS)).toBeNull();
	});

	test("a first-seen tie breaks on the larger deployment id", () => {
		const rows = [row("a", 60, 5), row("b", 60, 5)];
		expect(electLeader(rows, NOW, STALE_MS)).toBe("b");
		expect(electLeader([...rows].reverse(), NOW, STALE_MS)).toBe("b");
	});
});
