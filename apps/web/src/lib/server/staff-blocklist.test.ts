import { expect, test } from "bun:test";
import { queueSharedBlocklistAddition } from "#/lib/server/staff-blocklist";

const entry = {
	login: "ripgrim",
	reason: "Test only",
	expiresAt: "2099-01-01T00:00:00Z",
};

test("queues the verified GitHub account and links to its publishing run", async () => {
	const requests: Array<{ url: string; body: unknown }> = [];
	const request = async (url: string, init: RequestInit) => {
		requests.push({
			url: String(url),
			body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
		});
		return init?.method === "POST"
			? Response.json({ workflow_run_id: 42 })
			: Response.json({ id: 75869731, login: "ripgrim" });
	};
	expect(
		await queueSharedBlocklistAddition(
			{ ...entry, expiresAt: null },
			"staff",
			"fake",
			request,
		),
	).toEqual({
		status: "queued",
		url: "https://github.com/Boring-Software-Inc/tripwire-shared-blocklist/actions/runs/42",
	});
	expect(requests).toEqual([
		{ url: "https://api.github.com/users/ripgrim", body: null },
		{
			url: "https://api.github.com/repos/Boring-Software-Inc/tripwire-shared-blocklist/actions/workflows/publish-snapshot.yml/dispatches",
			body: {
				ref: "main",
				inputs: {
					...entry,
					expiresAt: "",
					accountId: "75869731",
					operation: "add",
				},
			},
		},
	]);
});

test("does not publish when the credential is missing, the entry expired or the account is unknown", async () => {
	const request = async () => new Response(null, { status: 404 });
	expect(
		await queueSharedBlocklistAddition(entry, "staff", "", request),
	).toEqual({ status: "unavailable" });
	expect(
		await queueSharedBlocklistAddition(
			{ ...entry, expiresAt: "2000-01-01T00:00:00Z" },
			"staff",
			"fake",
			request,
		),
	).toEqual({ status: "invalid-expiry" });
	expect(
		await queueSharedBlocklistAddition(entry, "staff", "fake", request),
	).toEqual({ status: "missing-account" });
});
