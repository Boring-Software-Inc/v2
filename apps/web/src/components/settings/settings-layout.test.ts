import { describe, expect, test } from "bun:test";
import { shouldAnimateSettingsExit } from "#/components/settings/settings-layout";

describe("settings layout navigation", () => {
	test("animates when navigation leaves settings", () => {
		expect(
			shouldAnimateSettingsExit(
				"/team/settings/general",
				"/team/home",
				"/team/settings",
			),
		).toBe(true);
	});

	test("does not interrupt navigation within settings", () => {
		expect(
			shouldAnimateSettingsExit(
				"/team/settings/general",
				"/team/settings/members",
				"/team/settings",
			),
		).toBe(false);
	});

	test("does not treat a matching path prefix as settings", () => {
		expect(
			shouldAnimateSettingsExit(
				"/team/settings-archive",
				"/team/home",
				"/team/settings",
			),
		).toBe(false);
	});
});
