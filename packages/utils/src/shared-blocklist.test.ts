import { expect, spyOn, test } from "bun:test";
import { loadPublishedSharedBlocklist } from "./shared-blocklist";

test("refreshes from the new staging commit even while the raw branch URL is stale", async () => {
	const originalEnvironment = process.env.UNKEY_ENVIRONMENT_SLUG;
	process.env.UNKEY_ENVIRONMENT_SLUG = "preview";
	const now = Date.now();
	const clock = spyOn(Date, "now").mockReturnValue(now);
	const oldCommit = "188497aa24abedc8c07a7b323ce7856c01deb2c5";
	const newCommit = "044a96e9eaf2a2d51120bf19549982d85ce25b18";
	const rawOrigin = "https://raw.githubusercontent.com";
	const rawRepo = `${rawOrigin}/Boring-Software-Inc/Pilot`;
	const refsUrl =
		"https://github.com/Boring-Software-Inc/Pilot.git/info/refs?service=git-upload-pack";
	const first = {
		version: 1,
		revision: 8,
		publishedAt: new Date(now - 1_000).toISOString(),
		entries: [
			{
				accountId: "258478242",
				login: "crabby-rathbun",
				reason: "Test entry",
				expiresAt: null,
			},
		],
	};
	const second = {
		...first,
		revision: 9,
		publishedAt: new Date(now + 1_000).toISOString(),
		entries: [
			...first.entries,
			{
				accountId: "116540790",
				login: "Adamchaua",
				reason: "Repeated bounty claims",
				expiresAt: null,
			},
		],
	};

	let stagingCommit = oldCommit;
	const request = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: Parameters<typeof fetch>[0]) => {
				switch (String(input)) {
					case refsUrl:
						return new Response(
							`001e# service=git-upload-pack\n00000042${newCommit} refs/heads/published\n004a${stagingCommit} refs/heads/published-staging\n0000`,
						);
					case `${rawRepo}/${oldCommit}/snapshot.json`:
					case `${rawRepo}/published-staging/snapshot.json`:
						return Response.json(first);
					case `${rawRepo}/${newCommit}/snapshot.json`:
						return Response.json(second);
					default:
						throw new Error(`Unexpected fetch: ${input}`);
				}
			},
			{ preconnect: fetch.preconnect },
		),
	);

	try {
		expect((await loadPublishedSharedBlocklist())?.revision).toBe(8);

		stagingCommit = newCommit;
		clock.mockReturnValue(now + 60_001);
		const snapshot = await loadPublishedSharedBlocklist();
		expect(snapshot?.revision).toBe(9);
		expect(snapshot?.entries.map((entry) => entry.accountId)).toEqual([
			"258478242",
			"116540790",
		]);

		stagingCommit = oldCommit;
		clock.mockReturnValue(now + 120_002);
		expect((await loadPublishedSharedBlocklist())?.revision).toBe(9);
	} finally {
		request.mockRestore();
		clock.mockRestore();
		if (originalEnvironment === undefined) {
			delete process.env.UNKEY_ENVIRONMENT_SLUG;
		} else {
			process.env.UNKEY_ENVIRONMENT_SLUG = originalEnvironment;
		}
	}
});
