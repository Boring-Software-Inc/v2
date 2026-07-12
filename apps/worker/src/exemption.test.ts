import { describe, expect, test } from "bun:test";
import {
	exemptionFlagRefusedInProd,
	isExemptionDisabled,
} from "./exemption.ts";

describe("isExemptionDisabled", () => {
	test("the affordance: exemption IS disabled when the flag is explicitly set (dev)", () => {
		expect(isExemptionDisabled({ TRIPWIRE_DISABLE_EXEMPTION: "true" })).toBe(
			true,
		);
	});

	test("refused in production — fails toward keeping maintainers exempt", () => {
		expect(
			isExemptionDisabled({
				TRIPWIRE_DISABLE_EXEMPTION: "true",
				NODE_ENV: "production",
			}),
		).toBe(false);
	});

	test("unset or non-'true' ⇒ exemption stays on", () => {
		expect(isExemptionDisabled({})).toBe(false);
		expect(isExemptionDisabled({ TRIPWIRE_DISABLE_EXEMPTION: "false" })).toBe(
			false,
		);
		expect(isExemptionDisabled({ TRIPWIRE_DISABLE_EXEMPTION: "1" })).toBe(
			false,
		);
	});
});

describe("exemptionFlagRefusedInProd", () => {
	test("true only when the flag is set AND production", () => {
		expect(
			exemptionFlagRefusedInProd({
				TRIPWIRE_DISABLE_EXEMPTION: "true",
				NODE_ENV: "production",
			}),
		).toBe(true);
		expect(
			exemptionFlagRefusedInProd({ TRIPWIRE_DISABLE_EXEMPTION: "true" }),
		).toBe(false);
		expect(exemptionFlagRefusedInProd({ NODE_ENV: "production" })).toBe(false);
	});
});
