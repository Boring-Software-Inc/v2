import { describe, expect, test } from "bun:test";
import { createDatabuddyApi, DatabuddyApiError } from "./databuddy-api.ts";

interface Call {
	url: string;
	headers: Headers;
	body: unknown;
}

function fakeFetch(
	respond: (call: Call) => { status: number; body: unknown },
): { fetch: typeof fetch; calls: Call[] } {
	const calls: Call[] = [];
	const impl = async (input: string | URL | Request, init?: RequestInit) => {
		const call: Call = {
			url: String(input),
			headers: new Headers(init?.headers),
			body: init?.body ? JSON.parse(String(init.body)) : null,
		};
		calls.push(call);
		const answer = respond(call);
		return new Response(JSON.stringify(answer.body), {
			status: answer.status,
			headers: { "content-type": "application/json" },
		});
	};
	return { fetch: impl as typeof fetch, calls };
}

const flag = {
	id: "flag_1",
	key: "show-sidebar",
	name: "Show sidebar",
	status: "active",
	defaultValue: false,
	rules: [],
};

describe("databuddy api client", () => {
	test("sends the key header and the website id", async () => {
		const fake = fakeFetch(() => ({ status: 200, body: [flag] }));
		const api = createDatabuddyApi({
			apiKey: "dbdy_test",
			websiteId: "site-1",
			baseUrl: "http://fake.local/",
			fetch: fake.fetch,
		});
		const flags = await api.listFlags();
		expect(flags[0]?.key).toBe("show-sidebar");
		expect(fake.calls[0]?.url).toBe("http://fake.local/flags/list");
		expect(fake.calls[0]?.headers.get("x-api-key")).toBe("dbdy_test");
		expect(fake.calls[0]?.body).toMatchObject({ websiteId: "site-1" });
	});

	test("a missing flag is null, other errors throw with the message", async () => {
		const missing = createDatabuddyApi({
			apiKey: "k",
			websiteId: "s",
			fetch: fakeFetch(() => ({
				status: 404,
				body: { code: "NOT_FOUND", message: "Flag not found" },
			})).fetch,
		});
		expect(await missing.getFlagByKey("nope")).toBeNull();

		const broken = createDatabuddyApi({
			apiKey: "k",
			websiteId: "s",
			fetch: fakeFetch(() => ({
				status: 403,
				body: { json: { message: "Missing scope manage:flags" } },
			})).fetch,
		});
		const error = await broken.getFlagByKey("x").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(DatabuddyApiError);
		expect(String(error)).toContain("Missing scope manage:flags");
	});

	test("update sends the whole rules array for the flag id", async () => {
		const fake = fakeFetch((call) => ({
			status: 200,
			body: { ...flag, rules: (call.body as { rules: unknown[] }).rules },
		}));
		const api = createDatabuddyApi({
			apiKey: "k",
			websiteId: "s",
			fetch: fake.fetch,
		});
		const rules = [{ type: "user_id", operator: "in", values: ["u1"] }];
		await api.updateFlagRules("flag_1", rules);
		expect(fake.calls[0]?.url).toBe("https://api.databuddy.cc/flags/update");
		expect(fake.calls[0]?.body).toEqual({ id: "flag_1", rules });
	});

	test("query returns rows keyed by parameter", async () => {
		const fake = fakeFetch(() => ({
			status: 200,
			body: {
				success: true,
				data: [
					{ parameter: "profile_detail", data: [{ total_sessions: 3 }] },
					{ parameter: "profile_sessions", data: [] },
				],
			},
		}));
		const api = createDatabuddyApi({
			apiKey: "k",
			websiteId: "site 1",
			fetch: fake.fetch,
		});
		const rows = await api.query({
			parameters: ["profile_detail", "profile_sessions"],
			filters: [{ field: "anonymous_id", op: "eq", value: "u1" }],
		});
		expect(rows.profile_detail).toEqual([{ total_sessions: 3 }]);
		expect(rows.profile_sessions).toEqual([]);
		expect(fake.calls[0]?.url).toBe(
			"https://api.databuddy.cc/v1/query?website_id=site%201",
		);
	});
});
