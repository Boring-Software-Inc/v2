import { describe, expect, test } from "bun:test";
import { detectWebview, formatEscapeLabel } from "./webview";

const X_IOS =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone";
const X_ANDROID =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36";
const SAFARI_IOS =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_DESKTOP =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("detectWebview", () => {
	test("the X app on iOS", () => {
		expect(detectWebview(X_IOS)).toBe("x");
	});

	test("the X app on Android, which only marks itself as a webview", () => {
		expect(detectWebview(X_ANDROID)).toBe("android-webview");
	});

	test("other in-app browsers", () => {
		expect(detectWebview("... Instagram 300.0.0.0")).toBe("instagram");
		expect(detectWebview("... [FBAN/FBIOS;FBAV/450.0]")).toBe("facebook");
		expect(detectWebview("... LinkedInApp")).toBe("linkedin");
		expect(detectWebview("... musical_ly_2022 BytedanceWebview")).toBe(
			"tiktok",
		);
	});

	test("real browsers are left alone", () => {
		expect(detectWebview(SAFARI_IOS)).toBeNull();
		expect(detectWebview(CHROME_DESKTOP)).toBeNull();
	});
});

describe("formatEscapeLabel", () => {
	test("drops the scheme and a trailing slash", () => {
		expect(
			formatEscapeLabel("https://app.tripwire.sh/login?redirect=%2F"),
		).toBe("app.tripwire.sh/login?redirect=%2F");
		expect(formatEscapeLabel("https://app.tripwire.sh/")).toBe(
			"app.tripwire.sh",
		);
	});
});
