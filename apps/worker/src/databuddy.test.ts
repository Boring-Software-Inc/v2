import { afterEach, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createDatabuddyApi } from "@tripwire/utils";
import { getDatabuddyApiConfig } from "@tripwire/utils/databuddy-server";

const originalId = process.env.DATABUDDY_WEBSITE_ID;
const originalKey = process.env.DATABUDDY_API_KEY;
afterEach(() => {
	if (originalId === undefined) delete process.env.DATABUDDY_WEBSITE_ID;
	else process.env.DATABUDDY_WEBSITE_ID = originalId;
	if (originalKey === undefined) delete process.env.DATABUDDY_API_KEY;
	else process.env.DATABUDDY_API_KEY = originalKey;
});

test("standard worker startup uses the shared server config seam, not auth or a hardcoded website", () => {
	const entry = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
	expect(entry).toContain("const databuddyConfig = getDatabuddyApiConfig()");
	expect(entry).toContain("createDatabuddyApi(databuddyConfig)");
	expect(entry).not.toContain("DATABUDDY_WEBSITE_ID");
	expect(entry).not.toContain("@tripwire/auth");
});

for (const websiteId of [undefined, "a512e6bc-385f-4b92-bceb-0692519edfc7"]) {
	test(`worker API config targets ${websiteId ?? "production fallback"} without launching jobs`, async () => {
		if (websiteId === undefined) delete process.env.DATABUDDY_WEBSITE_ID;
		else process.env.DATABUDDY_WEBSITE_ID = websiteId;
		delete process.env.DATABUDDY_API_KEY;
		expect(getDatabuddyApiConfig()).toBeNull();
		process.env.DATABUDDY_API_KEY = "TESTCANARY";
		const transport = spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json([]),
		);
		try {
			const config = getDatabuddyApiConfig();
			if (!config) throw new Error("Test management key missing");
			await createDatabuddyApi(config).listFlags();
			expect(transport).toHaveBeenCalledTimes(1);
			const init = transport.mock.calls[0]?.[1];
			expect(init?.headers).toEqual({
				"content-type": "application/json",
				"x-api-key": "TESTCANARY",
			});
			expect(JSON.parse(String(init?.body))).toEqual({
				websiteId: websiteId ?? "09661145-7249-45d9-a9e3-f1a93e9c7266",
				limit: 200,
			});
		} finally {
			transport.mockRestore();
		}
	});
}
