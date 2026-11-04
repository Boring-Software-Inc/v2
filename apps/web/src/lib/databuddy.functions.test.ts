import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

for (const websiteId of [undefined, "a512e6bc-385f-4b92-bceb-0692519edfc7"]) {
	test(`public root config and staff API agree: ${websiteId ?? "production fallback"}`, () => {
		const result = spawnSync(
			process.execPath,
			[
				"--no-env-file",
				"--eval",
				`
			import assert from "node:assert/strict";
			import { mock } from "bun:test";
			mock.module("@tanstack/react-start", () => ({
				createServerFn: () => ({ handler: (handler) => handler }),
			}));
			let flagConfig;
			mock.module("@databuddy/sdk/node", () => ({
				createServerFlagsManager: (config) => {
					flagConfig = config;
					return { getFlag: async () => ({ enabled: true, reason: "RULE_MATCH" }) };
				},
			}));
			const requests = [];
			globalThis.fetch = async (url, init) => {
				requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
				return Response.json([]);
			};
			const expected = process.env.DATABUDDY_WEBSITE_ID ?? "09661145-7249-45d9-a9e3-f1a93e9c7266";
			const { getPublicDatabuddyConfig } = await import("#/lib/databuddy.functions");
			const data = await getPublicDatabuddyConfig();
			assert.deepEqual(data, { databuddyWebsiteId: expected });
			assert.equal(JSON.stringify(data).includes("TESTCANARY"), false);
			const { getDatabuddyApi, getFlagEvaluator } = await import("#/lib/server/staff-users");
			await getDatabuddyApi().listFlags();
			assert.deepEqual(requests, [{
				url: "https://management.test/flags/list",
				headers: { "content-type": "application/json", "x-api-key": "TESTCANARY" },
				body: { websiteId: expected, limit: 200 },
			}]);
			await (await getFlagEvaluator())(["show-sidebar"], { userId: "staff" });
			assert.deepEqual(flagConfig, { clientId: expected, apiUrl: "https://management.test", cacheTtl: 1 });
			const { isAccessGateEnabled } = await import("@tripwire/auth/access-gate");
			assert.deepEqual(flagConfig, { clientId: expected });
			assert.equal(await isAccessGateEnabled({ userId: "pending" }), true);
		`,
			],
			{
				cwd: fileURLToPath(new URL("../../", import.meta.url)),
				env: {
					PATH: process.env.PATH,
					NODE_ENV: "test",
					DATABUDDY_API_KEY: "TESTCANARY",
					DATABUDDY_API_URL: "https://management.test",
					...(websiteId ? { DATABUDDY_WEBSITE_ID: websiteId } : {}),
				},
				encoding: "utf8",
			},
		);
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
	});
}

test("root loader covers public routes independently of session early returns and wires both browser consumers", () => {
	const root = readFileSync(
		new URL("../routes/__root.tsx", import.meta.url),
		"utf8",
	);
	expect(root).toContain("loader: () => getPublicDatabuddyConfig()");
	expect(root).toContain(
		"const { databuddyWebsiteId } = Route.useLoaderData()",
	);
	expect(root).toContain("<FlagsProvider clientId={databuddyWebsiteId}>");
	expect(root).toContain(
		"<DatabuddyAnalytics websiteId={databuddyWebsiteId} />",
	);
	expect(root).not.toContain("DATABUDDY_CLIENT_ID");
	expect(root).not.toContain("m.Databuddy");
	const section = readFileSync(
		new URL(
			"../components/admin/user-sheet/flags-section.tsx",
			import.meta.url,
		),
		"utf8",
	);
	expect(section).toContain('getRouteApi("__root__").useLoaderData()');
	expect(section).toContain("databuddyUserUrl(user.id, databuddyWebsiteId)");
});
