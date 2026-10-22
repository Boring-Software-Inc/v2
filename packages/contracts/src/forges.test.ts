import { describe, expect, test } from "bun:test";
import {
	changeRequestUrl,
	forgeConnectable,
	forgeSignIn,
	LIVE_FORGE_LABELS,
	SIGN_IN_FORGE_IDS,
} from "./forges.ts";

describe("changeRequestUrl", () => {
	test("github uses /pull/ and open-git uses /pulls/", () => {
		expect(
			changeRequestUrl({
				forge: "github",
				repoFullName: "acme/api",
				number: 7,
			}),
		).toBe("https://github.com/acme/api/pull/7");
		expect(
			changeRequestUrl({
				forge: "opengit",
				repoFullName: "acme/api",
				number: 7,
			}),
		).toBe("https://open-git.com/acme/api/pulls/7");
	});

	test("a self-hosted origin replaces the public host", () => {
		expect(
			changeRequestUrl({
				forge: "opengit",
				repoFullName: "acme/api",
				number: 7,
				origin: "https://git.internal/",
			}),
		).toBe("https://git.internal/acme/api/pulls/7");
	});

	test("no change request means no link", () => {
		expect(
			changeRequestUrl({
				forge: "github",
				repoFullName: "acme/api",
				number: null,
			}),
		).toBeNull();
	});
});

describe("paused forges", () => {
	test("open-git stays ingestible but cannot be connected or signed into", () => {
		expect(forgeConnectable("github")).toBe(true);
		expect(forgeConnectable("opengit")).toBe(false);
		expect(forgeSignIn("opengit")).toBeNull();
		expect(SIGN_IN_FORGE_IDS).toEqual(["github"]);
		expect(LIVE_FORGE_LABELS).toEqual(["GitHub"]);
	});
});
