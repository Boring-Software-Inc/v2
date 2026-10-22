import { describe, expect, test } from "bun:test";
import type { captureMessage } from "@sentry/bun";
import pino from "pino";
import {
	type InstallFailure,
	installFailureEvent,
	installFailureReporter,
} from "./report-install-failure.ts";

describe("installFailureEvent", () => {
	test("user-facing states are warnings", () => {
		expect(
			installFailureEvent({
				state: "not-for-tripwire",
				installationId: "1",
				userId: null,
			}).level,
		).toBe("warning");
		expect(
			installFailureEvent({
				state: "token-expired",
				installationId: "1",
				userId: null,
			}).level,
		).toBe("warning");
	});

	test("broken states are errors", () => {
		for (const state of [
			"recovery-failed",
			"unverifiable",
			"unreadable",
		] as const) {
			expect(
				installFailureEvent({ state, installationId: "1", userId: null }).level,
			).toBe("error");
		}
	});

	test("tags the installation and state, and sends only the user id", () => {
		expect(
			installFailureEvent({
				state: "recovery-failed",
				installationId: "42",
				userId: "user_1",
				error: "boom",
			}),
		).toEqual({
			level: "error",
			tags: { installation_id: "42", state: "recovery-failed" },
			user: { id: "user_1" },
			extra: { error: "boom" },
		});
	});

	test("omits the user when there is none", () => {
		expect(
			installFailureEvent({
				state: "unreadable",
				installationId: "unknown",
				userId: null,
			}).user,
		).toBeUndefined();
	});
});

describe("installFailureReporter", () => {
	test("logs the failure and sends it to sentry", () => {
		const lines: string[] = [];
		const logger = pino(
			{ base: null, timestamp: false },
			{ write: (line: string) => lines.push(line) },
		);
		const sent: Parameters<typeof captureMessage>[] = [];
		const failure: InstallFailure = {
			state: "token-expired",
			installationId: "7",
			userId: "user_2",
		};

		installFailureReporter(logger, (message, context) => {
			sent.push([message, context]);
			return "event-id";
		})(failure);

		expect(lines.map((line) => JSON.parse(line).msg)).toEqual([
			"install flow failure",
		]);
		expect(sent).toEqual([
			["install flow failure: token-expired", installFailureEvent(failure)],
		]);
	});
});
