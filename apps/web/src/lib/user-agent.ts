const BROWSERS: [RegExp, string][] = [
	[/Edg\//, "Edge"],
	[/OPR\/|Opera/, "Opera"],
	[/Firefox\//, "Firefox"],
	[/Chrome\/|CriOS\//, "Chrome"],
	[/Version\/[\d.]+.*Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
	[/iPhone/, "iPhone"],
	[/iPad/, "iPad"],
	[/Android/, "Android"],
	[/Mac OS X|Macintosh/, "macOS"],
	[/Windows/, "Windows"],
	[/CrOS/, "ChromeOS"],
	[/Linux/, "Linux"],
];

function first(table: [RegExp, string][], ua: string): string | null {
	return table.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
}

export function describeUserAgent(ua: string | null | undefined): string {
	const value = ua?.trim() ?? "";
	if (!value) {
		return "Unknown device";
	}
	const browser = first(BROWSERS, value);
	const system = first(SYSTEMS, value);
	if (browser && system) {
		return `${browser} on ${system}`;
	}
	if (browser || system) {
		return browser ?? system ?? value;
	}
	return value.split(/[\s/]/)[0] || "Unknown device";
}
