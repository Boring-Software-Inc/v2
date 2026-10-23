import { describe, expect, test } from "bun:test";
import { route } from "#/program";

describe("route", () => {
	test("runs install only when the first command is install", () => {
		expect(route(["install"])).toEqual({ kind: "run", argv: ["install"] });
		expect(route(["install", "acme#abcde12345"])).toEqual({
			kind: "run",
			argv: ["install", "acme#abcde12345"],
		});
	});

	test("unknown commands never fall through to install", () => {
		expect(route(["list_repos"])).toEqual({
			kind: "unknown",
			command: "list_repos",
		});
		expect(route(["acme#abcde12345"])).toEqual({
			kind: "unknown",
			command: "acme#abcde12345",
		});
		expect(route(["--json", "instal"])).toEqual({
			kind: "unknown",
			command: "instal",
		});
	});

	test("no command shows help", () => {
		expect(route([])).toEqual({ kind: "help" });
		expect(route(["--no-interactive"])).toEqual({ kind: "help" });
	});

	test("keeps known commands after global options", () => {
		expect(route(["--json", "whoami"])).toEqual({
			kind: "run",
			argv: ["--json", "whoami"],
		});
		expect(route(["--org", "acme", "repos"])).toEqual({
			kind: "run",
			argv: ["--org", "acme", "repos"],
		});
		expect(route(["rules", "list"])).toEqual({
			kind: "run",
			argv: ["rules", "list"],
		});
	});

	test("leaves help and version alone", () => {
		expect(route(["--help"])).toEqual({ kind: "run", argv: ["--help"] });
		expect(route(["-V"])).toEqual({ kind: "run", argv: ["-V"] });
	});
});
