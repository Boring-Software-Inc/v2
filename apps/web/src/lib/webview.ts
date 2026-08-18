/**
 * Embedded in-app browsers (X, Instagram, Facebook, TikTok...) run OAuth in a
 * webview the provider often refuses, so the login page tells the user to move
 * the link to a real browser. Detection is pure over the user agent so it can
 * be unit tested without a DOM, and so the server can run it against the
 * request header.
 */

export type WebviewHost =
	| "x"
	| "instagram"
	| "facebook"
	| "linkedin"
	| "snapchat"
	| "tiktok"
	| "discord"
	| "android-webview";

const WEBVIEW_SIGNATURES: ReadonlyArray<{
	host: WebviewHost;
	pattern: RegExp;
}> = [
	{ host: "x", pattern: /\bTwitter(?:\s|For|Android)/i },
	{ host: "instagram", pattern: /\bInstagram\b/i },
	{ host: "facebook", pattern: /\bFB(?:AN|AV|_IAB)\b/i },
	{ host: "linkedin", pattern: /\bLinkedInApp\b/i },
	{ host: "snapchat", pattern: /\bSnapchat\b/i },
	{ host: "tiktok", pattern: /\b(?:musical_ly|BytedanceWebview|Bytelo)\b/i },
	{ host: "discord", pattern: /\bDiscord\b/i },
	// Generic Android webview marker — X on Android ships no app token, only `wv`.
	{ host: "android-webview", pattern: /;\s*wv\)/i },
];

export function detectWebview(userAgent: string): WebviewHost | null {
	for (const { host, pattern } of WEBVIEW_SIGNATURES) {
		if (pattern.test(userAgent)) {
			return host;
		}
	}
	return null;
}

/** The url as the design shows it: host and path, no scheme. */
export function formatEscapeLabel(href: string): string {
	return href.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
