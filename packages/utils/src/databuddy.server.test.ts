import { afterEach, describe, expect, test } from "bun:test";
import {
	getDatabuddyApiConfig,
	getDatabuddyWebsiteId,
} from "./databuddy.server.ts";

const original = { ...process.env };
afterEach(() => {
	for (const key of [
		"DATABUDDY_WEBSITE_ID",
		"DATABUDDY_API_KEY",
		"DATABUDDY_API_URL",
	]) {
		if (original[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = original[key];
		}
	}
});

describe("Databuddy server runtime configuration", () => {
	test("defaults only an absent ID to the existing production project", () => {
		delete process.env.DATABUDDY_WEBSITE_ID;
		expect(getDatabuddyWebsiteId()).toBe(
			"09661145-7249-45d9-a9e3-f1a93e9c7266",
		);
		process.env.DATABUDDY_WEBSITE_ID = "";
		expect(getDatabuddyWebsiteId()).toBe("");
		process.env.DATABUDDY_WEBSITE_ID = "explicit-invalid-value";
		expect(getDatabuddyWebsiteId()).toBe("explicit-invalid-value");
	});

	test("reads staging at runtime without changing the independent management key or endpoint", () => {
		process.env.DATABUDDY_WEBSITE_ID = "a512e6bc-385f-4b92-bceb-0692519edfc7";
		delete process.env.DATABUDDY_API_KEY;
		expect(getDatabuddyApiConfig()).toBeNull();
		process.env.DATABUDDY_API_KEY = "TESTCANARY";
		process.env.DATABUDDY_API_URL = "https://databuddy.test";
		expect(getDatabuddyApiConfig()).toEqual({
			websiteId: "a512e6bc-385f-4b92-bceb-0692519edfc7",
			apiKey: "TESTCANARY",
			baseUrl: "https://databuddy.test",
		});
		delete process.env.DATABUDDY_WEBSITE_ID;
		expect(getDatabuddyApiConfig()?.websiteId).toBe(
			"09661145-7249-45d9-a9e3-f1a93e9c7266",
		);
	});
});
