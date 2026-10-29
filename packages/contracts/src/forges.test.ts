import { describe, expect, test } from "bun:test";
import {
	changeRequestUrl,
	configuredSignInProviderIdsSchema,
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
		expect(SIGN_IN_FORGE_IDS).toEqual(["github", "gitcafe"]);
		expect(LIVE_FORGE_LABELS).toEqual(["GitHub", "GitCafe"]);
	});
});

test("GitCafe supports sign-in, connection and native pull links", async () => {
	const {
		DEFAULT_FORGE_ORIGIN,
		forgeIdSchema,
		forgeSchema,
		forgePostsReviews,
	} = await import("./forges.ts");
	expect(forgeIdSchema.parse("gitcafe")).toBe("gitcafe");
	expect(forgeSchema.safeParse("gitcafe").success).toBe(true);
	expect(forgeSignIn("gitcafe")).toBe("social");
	expect(forgeConnectable("gitcafe")).toBe(true);
	expect(forgePostsReviews("gitcafe")).toBe(true);
	expect(DEFAULT_FORGE_ORIGIN.gitcafe).toBe("https://git.cafe");
	expect(DEFAULT_FORGE_ORIGIN.opengit).toBe("https://open-git.com");
	expect(
		changeRequestUrl({
			forge: "gitcafe",
			repoFullName: "owner/repo",
			number: 7,
		}),
	).toBe("https://git.cafe/owner/repo/pull/7");
});

test("configured sign-in providers contain only known IDs, never credentials", () => {
	expect(configuredSignInProviderIdsSchema.parse([])).toEqual([]);
	expect(
		configuredSignInProviderIdsSchema.parse(["github", "gitcafe"]),
	).toEqual(["github", "gitcafe"]);
	for (const value of [
		["unknown"],
		[{ id: "gitcafe", clientId: "private" }],
		{ providerIds: ["github"], clientSecret: "private" },
	]) {
		expect(configuredSignInProviderIdsSchema.safeParse(value).success).toBe(
			false,
		);
	}
});
