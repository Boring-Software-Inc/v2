import { describe, expect, test } from "bun:test";
import {
	loginSearchSchema,
	oauthPopupSearchSchema,
	oauthWaitlistSearchSchema,
	type WaitlistNotification,
	waitlistNotificationSchema,
} from "./oauth-search.ts";

describe("OAuth search field projections", () => {
	for (const value of [undefined, null, false, 0, 17, [], {}, ["popup"]]) {
		test(`non-string field ${JSON.stringify(value)} stays absent`, () => {
			expect(
				oauthWaitlistSearchSchema.parse({ opener: value, mode: value }),
			).toEqual({ opener: undefined, mode: undefined });
			expect(
				oauthPopupSearchSchema.parse({ error: value }).error,
			).toBeUndefined();
			expect(
				loginSearchSchema.parse({ redirect: value }).redirect,
			).toBeUndefined();
		});
	}

	test("strings retain empties, whitespace, origin and query bytes", () => {
		expect(
			oauthPopupSearchSchema.parse({
				opener: "https://landing.example",
				mode: "popup",
				error: " ",
				unused: "kept by its own consumer",
			}),
		).toEqual({ opener: "https://landing.example", mode: "popup", error: " " });
		for (const redirect of [
			"",
			" ",
			"/",
			"/org/home?x=%2F",
			"//external.example",
			"https://external.example",
		]) {
			expect(loginSearchSchema.parse({ redirect }).redirect).toBe(redirect);
		}
	});

	test("malformed field objects do not read constructor metadata", () => {
		let reads = 0;
		const value = Object.create({
			get constructor() {
				reads += 1;
				throw new Error("unexpected constructor read");
			},
		});
		expect(
			loginSearchSchema.parse({ redirect: value }).redirect,
		).toBeUndefined();
		expect(
			oauthPopupSearchSchema.parse({ error: value }).error,
		).toBeUndefined();
		expect(reads).toBe(0);
	});
});

describe("waitlist notification wire contract", () => {
	test("keeps the error message distinct from access notifications", () => {
		expect(
			waitlistNotificationSchema.parse({
				type: "tripwire:waitlist",
				status: "error",
			}),
		).toEqual({ type: "tripwire:waitlist", status: "error" });
		for (const status of ["pending", "approved", "rejected"] as const) {
			const payload = {
				type: "tripwire:waitlist",
				status,
				name: "Ωmega <b>literal</b>",
			} satisfies WaitlistNotification;
			expect(waitlistNotificationSchema.parse(payload)).toEqual(payload);
		}
	});

	test("rejects another channel and unknown statuses", () => {
		expect(
			waitlistNotificationSchema.safeParse({ type: "other", status: "error" })
				.success,
		).toBe(false);
		expect(
			waitlistNotificationSchema.safeParse({
				type: "tripwire:waitlist",
				status: "staff",
				name: "n",
			}).success,
		).toBe(false);
	});
});
