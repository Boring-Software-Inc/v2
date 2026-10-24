import { describe, expect, test } from "bun:test";
import { isCrossSiteRequest } from "#/lib/server/same-origin";

const TRUSTED = ["https://app.tripwire.sh"];

function headers(init: Record<string, string>): Headers {
	return new Headers(init);
}

describe("isCrossSiteRequest", () => {
	test("a same-origin browser request passes", () => {
		expect(
			isCrossSiteRequest(headers({ "sec-fetch-site": "same-origin" }), TRUSTED),
		).toBe(false);
	});

	test("a cross-site or same-site browser request is refused", () => {
		for (const site of ["cross-site", "same-site", "none"]) {
			expect(
				isCrossSiteRequest(headers({ "sec-fetch-site": site }), TRUSTED),
			).toBe(true);
		}
	});

	test("without fetch metadata the Origin must be this host or a trusted one", () => {
		expect(
			isCrossSiteRequest(
				headers({ origin: "https://app.tripwire.sh", host: "internal:3000" }),
				TRUSTED,
			),
		).toBe(false);
		expect(
			isCrossSiteRequest(
				headers({ origin: "http://localhost:3443", host: "localhost:3443" }),
				[],
			),
		).toBe(false);
		expect(
			isCrossSiteRequest(
				headers({ origin: "https://evil.example", host: "app.tripwire.sh" }),
				TRUSTED,
			),
		).toBe(true);
		expect(
			isCrossSiteRequest(
				headers({ origin: "null", host: "app.tripwire.sh" }),
				TRUSTED,
			),
		).toBe(true);
	});

	test("a request with neither header is not a browser form post", () => {
		expect(isCrossSiteRequest(headers({}), TRUSTED)).toBe(false);
	});
});
