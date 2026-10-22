import { describe, expect, test } from "bun:test";
import {
	INVITE_STATUSES,
	ORG_SEARCH_DEFAULTS,
	ORG_SETTINGS_TABS,
	orgSearchSchema,
} from "./org-search";

describe("orgSearchSchema", () => {
	test("leaves the settings dialog closed and shows active invites", () => {
		expect(orgSearchSchema.parse({})).toEqual({
			settings: undefined,
			...ORG_SEARCH_DEFAULTS,
		});
	});

	test("falls back on bad values", () => {
		expect(orgSearchSchema.parse({ settings: "audit", invites: 1 })).toEqual({
			settings: undefined,
			invites: "active",
		});
	});

	test("round trips every settings tab and invite status", () => {
		for (const settings of ORG_SETTINGS_TABS) {
			for (const invites of INVITE_STATUSES) {
				expect(orgSearchSchema.parse({ settings, invites })).toEqual({
					settings,
					invites,
				});
			}
		}
	});
});
