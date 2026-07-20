import { afterEach, describe, expect, test } from "bun:test";
import {
	DEFAULT_RERUN_COOLDOWN_SECONDS,
	getRerunCooldownSeconds,
} from "./queue.ts";

describe("getRerunCooldownSeconds", () => {
	const prev = process.env.RERUN_COOLDOWN_SECONDS;

	afterEach(() => {
		if (prev === undefined) {
			delete process.env.RERUN_COOLDOWN_SECONDS;
		} else {
			process.env.RERUN_COOLDOWN_SECONDS = prev;
		}
	});

	test("defaults when unset", () => {
		delete process.env.RERUN_COOLDOWN_SECONDS;
		expect(getRerunCooldownSeconds()).toBe(DEFAULT_RERUN_COOLDOWN_SECONDS);
	});

	test("reads a positive env value", () => {
		process.env.RERUN_COOLDOWN_SECONDS = "60";
		expect(getRerunCooldownSeconds()).toBe(60);
	});

	test("allows zero (disable globally)", () => {
		process.env.RERUN_COOLDOWN_SECONDS = "0";
		expect(getRerunCooldownSeconds()).toBe(0);
	});

	test("invalid values fall back to default", () => {
		process.env.RERUN_COOLDOWN_SECONDS = "nope";
		expect(getRerunCooldownSeconds()).toBe(DEFAULT_RERUN_COOLDOWN_SECONDS);
		process.env.RERUN_COOLDOWN_SECONDS = "-3";
		expect(getRerunCooldownSeconds()).toBe(DEFAULT_RERUN_COOLDOWN_SECONDS);
	});
});
