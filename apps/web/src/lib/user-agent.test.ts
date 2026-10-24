import { describe, expect, test } from "bun:test";
import { describeUserAgent } from "#/lib/user-agent";

describe("describeUserAgent", () => {
	test.each([
		[
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
			"Chrome on macOS",
		],
		[
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
			"Safari on macOS",
		],
		[
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
			"Safari on iPhone",
		],
		[
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
			"Edge on Windows",
		],
		[
			"Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
			"Firefox on Linux",
		],
		[
			"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
			"Chrome on Android",
		],
		["tripwire-cli/1.2.0", "tripwire-cli"],
		["", "Unknown device"],
		[null, "Unknown device"],
	])("%p reads as %p", (ua, expected) => {
		expect(describeUserAgent(ua)).toBe(expected);
	});
});
