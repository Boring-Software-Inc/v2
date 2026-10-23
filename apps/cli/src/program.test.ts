import { describe, expect, test } from "bun:test";
import { withDefaultCommand } from "#/program";

describe("withDefaultCommand", () => {
	test("defaults to install", () => {
		expect(withDefaultCommand([])).toEqual(["install"]);
		expect(withDefaultCommand(["acme#abcde12345"])).toEqual([
			"install",
			"acme#abcde12345",
		]);
		expect(withDefaultCommand(["--no-interactive"])).toEqual([
			"install",
			"--no-interactive",
		]);
	});

	test("keeps known commands after global options", () => {
		expect(withDefaultCommand(["--json", "whoami"])).toEqual([
			"--json",
			"whoami",
		]);
		expect(withDefaultCommand(["--org", "acme", "repos"])).toEqual([
			"--org",
			"acme",
			"repos",
		]);
		expect(withDefaultCommand(["rules", "list"])).toEqual(["rules", "list"]);
	});

	test("leaves help and version alone", () => {
		expect(withDefaultCommand(["--help"])).toEqual(["--help"]);
		expect(withDefaultCommand(["-V"])).toEqual(["-V"]);
	});
});
