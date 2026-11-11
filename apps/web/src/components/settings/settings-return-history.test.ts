import { describe, expect, test } from "bun:test";
import {
	rememberSettingsEntry,
	settingsReturnDelta,
} from "#/components/settings/settings-return-history";

function location(pathname: string, index: number) {
	return {
		href: pathname,
		pathname,
		state: { __TSR_index: index },
	};
}

describe("settings return history", () => {
	test("returns to the route used to enter settings", () => {
		rememberSettingsEntry(
			location("/return-route/home", 4),
			location("/return-route/settings/members", 5),
		);

		expect(settingsReturnDelta("return-route", 5)).toBe(-1);
	});

	test("settings navigation does not replace the original return route", () => {
		rememberSettingsEntry(
			location("/stable-route/activity", 8),
			location("/stable-route/settings/members", 9),
		);
		rememberSettingsEntry(
			location("/stable-route/settings/members", 9),
			location("/stable-route/settings/roles", 10),
		);

		expect(settingsReturnDelta("stable-route", 10)).toBe(-2);
	});

	test("has no return target when settings was opened directly", () => {
		rememberSettingsEntry(
			undefined,
			location("/direct-route/settings/roles", 1),
		);

		expect(settingsReturnDelta("direct-route", 1)).toBeNull();
	});
});
