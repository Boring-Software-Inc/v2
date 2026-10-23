import { describe, expect, test } from "bun:test";
import { GithubHttp } from "./http.ts";
import { listRepoReviewers } from "./reviewers.ts";

function collaborator(
	id: number,
	login: string,
	role: string,
	permissions: { admin: boolean; maintain: boolean; push: boolean },
) {
	return {
		login,
		id,
		node_id: `MDQ6VXNlcj${id}`,
		avatar_url: `https://avatars.githubusercontent.com/u/${id}?v=4`,
		gravatar_id: "",
		url: `https://api.github.com/users/${login}`,
		html_url: `https://github.com/${login}`,
		type: "User",
		site_admin: false,
		permissions: { ...permissions, triage: true, pull: true },
		role_name: role,
	};
}

function httpWith(pages: Record<number, object[]>, seen: string[] = []) {
	return new GithubHttp({
		tokenFor: () => Promise.resolve("t"),
		appId: 1,
		fetchImpl: ((url: string | URL | Request) => {
			seen.push(String(url));
			const page = Number(new URL(String(url)).searchParams.get("page"));
			return Promise.resolve(
				new Response(JSON.stringify(pages[page] ?? []), { status: 200 }),
			);
		}) as typeof fetch,
	});
}

describe("listRepoReviewers", () => {
	test("asks for push collaborators and maps them to reviewers", async () => {
		const seen: string[] = [];
		const reviewers = await listRepoReviewers(
			httpWith(
				{
					1: [
						collaborator(583231, "octocat", "admin", {
							admin: true,
							maintain: true,
							push: true,
						}),
						collaborator(480938, "hubot", "write", {
							admin: false,
							maintain: false,
							push: true,
						}),
					],
				},
				seen,
			),
			"acme/app",
		);
		expect(seen).toEqual([
			"https://api.github.com/repos/acme/app/collaborators?affiliation=all&permission=push&per_page=100&page=1",
		]);
		expect(reviewers).toEqual([
			{
				id: 583231,
				login: "octocat",
				avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
				permission: "admin",
			},
			{
				id: 480938,
				login: "hubot",
				avatarUrl: "https://avatars.githubusercontent.com/u/480938?v=4",
				permission: "write",
			},
		]);
	});

	test("follows full pages until a short one", async () => {
		const full = Array.from({ length: 100 }, (_, i) =>
			collaborator(1000 + i, `user${i}`, "write", {
				admin: false,
				maintain: false,
				push: true,
			}),
		);
		const seen: string[] = [];
		const reviewers = await listRepoReviewers(
			httpWith(
				{
					1: full,
					2: [
						collaborator(9, "last", "maintain", {
							admin: false,
							maintain: true,
							push: true,
						}),
					],
				},
				seen,
			),
			"acme/app",
		);
		expect(seen).toHaveLength(2);
		expect(reviewers).toHaveLength(101);
		expect(reviewers.at(-1)).toMatchObject({
			login: "last",
			permission: "maintain",
		});
	});

	test("drops people who cannot push and logins GitHub reviews cannot take", async () => {
		const reviewers = await listRepoReviewers(
			httpWith({
				1: [
					collaborator(1, "reader", "read", {
						admin: false,
						maintain: false,
						push: false,
					}),
					collaborator(2, "renovate[bot]", "write", {
						admin: false,
						maintain: false,
						push: true,
					}),
					{ login: "no-id" },
					collaborator(3, "keeper", "write", {
						admin: false,
						maintain: false,
						push: true,
					}),
				],
			}),
			"acme/app",
		);
		expect(reviewers.map((reviewer) => reviewer.login)).toEqual(["keeper"]);
	});

	test("a failed page throws so the caller keeps the old set", async () => {
		const http = new GithubHttp({
			tokenFor: () => Promise.resolve("t"),
			appId: 1,
			fetchImpl: ((_url: string | URL | Request) =>
				Promise.resolve(
					new Response("Not Found", { status: 404 }),
				)) as typeof fetch,
		});
		await expect(listRepoReviewers(http, "acme/app")).rejects.toThrow(/404/);
	});
});
