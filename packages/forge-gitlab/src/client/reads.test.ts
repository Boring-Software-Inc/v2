import { expect, test } from "bun:test";
import { GitlabReads } from "./reads.ts";

/**
 * Regression: GitLab serves TWO different user shapes. `GET /users?username=`
 * returns the LIMITED public object — id, username, avatar, and nothing else —
 * while `created_at` and `bio` only exist on `GET /users/:id`. Reading the
 * fields off the list response silently produced `createdAt: undefined` for
 * every GitLab contributor, which defeated account-age@1 without erroring.
 *
 * Shapes below are the real gitlab.com responses (field sets verified live,
 * values scrubbed), not invented from docs.
 */
const LIMITED_USER = {
	id: 22514186,
	username: "vys69",
	public_email: "",
	name: "vys",
	state: "active",
	locked: false,
	avatar_url: "https://gitlab.com/avatar.png",
	web_url: "https://gitlab.com/vys69",
};

const FULL_USER = {
	...LIMITED_USER,
	created_at: "2024-08-19T22:00:21.405Z",
	bio: "builds things",
	location: null,
	bot: false,
};

function stubFetch(seen: string[]): typeof fetch {
	return (async (url: string | URL) => {
		const path = String(url);
		seen.push(path);
		const body = (() => {
			if (path.includes("/users?username=")) {
				return [LIMITED_USER];
			}
			if (/\/users\/\d+$/.test(path)) {
				return FULL_USER;
			}
			// Every secondary read (followers, merged MRs, membership) is
			// best-effort in the adapter; an empty list keeps this test on the
			// profile shape.
			return [];
		})();
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
}

test("getContributorProfile reads account age from the FULL user endpoint", async () => {
	const seen: string[] = [];
	const reads = new GitlabReads({
		tokenFor: async () => "t",
		fetchImpl: stubFetch(seen),
	});

	const profile = await reads.getContributorProfile("acme/app", "vys69");

	// The bug: these came back undefined because only the list call was made.
	expect(profile.createdAt).toBe("2024-08-19T22:00:21.405Z");
	expect(profile.profileText).toBe("builds things");
	expect(profile.externalId).toBe("22514186");

	// The list call alone cannot answer account age — the id lookup must be
	// followed by the single-user fetch.
	expect(seen.some((u) => u.includes("/users?username=vys69"))).toBe(true);
	expect(seen.some((u) => /\/users\/22514186$/.test(u))).toBe(true);
});

test("getContributorProfile keeps profileText null when the forge has no bio", async () => {
	const reads = new GitlabReads({
		tokenFor: async () => "t",
		fetchImpl: (async (url: string | URL) => {
			const path = String(url);
			const body = path.includes("/users?username=")
				? [LIMITED_USER]
				: /\/users\/\d+$/.test(path)
					? { ...FULL_USER, bio: null }
					: [];
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch,
	});

	const profile = await reads.getContributorProfile("acme/app", "vys69");
	// null, never undefined — the contract is `string | null`.
	expect(profile.profileText).toBeNull();
});
