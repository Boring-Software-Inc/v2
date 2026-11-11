import { expect, test } from "bun:test";
import { lookupGitHubAccount } from "#/lib/server/github-account";

test("returns GitHub's canonical login and stable account ID", async () => {
	let requestedUrl = "";
	let options: RequestInit | undefined;
	const account = await lookupGitHubAccount(
		"ripgrim",
		undefined,
		async (url, init) => {
			requestedUrl = url;
			options = init;
			return Response.json({ id: 75869731, login: "ripgrim" });
		},
	);
	expect(account).toEqual({ id: 75869731, login: "ripgrim" });
	expect(requestedUrl).toBe("https://api.github.com/users/ripgrim");
	expect(options?.redirect).toBe("error");
	expect(options?.signal).toBeInstanceOf(AbortSignal);
});

test("an unknown account does not produce an allowlist entry", async () => {
	const account = await lookupGitHubAccount(
		"missing",
		undefined,
		async () => new Response(null, { status: 404 }),
	);
	expect(account).toBeNull();
});

test("GitHub rate limits and malformed replies reject the lookup", async () => {
	await expect(
		lookupGitHubAccount(
			"ripgrim",
			undefined,
			async () => new Response(null, { status: 429 }),
		),
	).rejects.toThrow("GitHub lookup returned 429");
	await expect(
		lookupGitHubAccount("ripgrim", undefined, async () =>
			Response.json({ login: "ripgrim" }),
		),
	).rejects.toThrow();
});

test("GitHub App bot logins can be added to the contributor allowlist", async () => {
	const account = await lookupGitHubAccount(
		"dependabot[bot]",
		undefined,
		async () => Response.json({ id: 49699333, login: "dependabot[bot]" }),
	);
	expect(account).toEqual({ id: 49699333, login: "dependabot[bot]" });
});
