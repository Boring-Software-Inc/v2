import { describe, expect, test } from "bun:test";
import { githubLogin } from "./forge-identity.ts";

describe("githubLogin response parsing", () => {
	test.each([
		["null", "null"],
		["array", "[]"],
		["string", '"jdoe"'],
		["missing login", "{}"],
		["null login", '{"login":null}'],
		["numeric login", '{"login":42}'],
		["object login", '{"login":{}}'],
		["array login", '{"login":["jdoe"]}'],
		["empty login", '{"login":""}'],
		["invalid JSON", "{"],
	])("returns null for %s", async (_name, body) => {
		expect(
			await githubLogin("gho_token", async () => new Response(body)),
		).toBeNull();
	});

	test("accepts extra user fields without normalizing the login", async () => {
		expect(
			await githubLogin(
				"gho_token",
				async () => new Response('{"login":" jdoe ","name":"Jane Doe"}'),
			),
		).toBe(" jdoe ");
	});

	test("keeps the existing non-empty whitespace login behavior", async () => {
		expect(
			await githubLogin("gho_token", async () => new Response('{"login":" "}')),
		).toBe(" ");
	});
});
