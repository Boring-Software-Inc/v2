import { expect, test } from "bun:test";
import { parseScheduleText } from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleTextField } from "#/components/workflows/editor/schedule-input";

function renderDraft(draft: string, readOnly = false) {
	const events: string[] = [];
	const html = renderToStaticMarkup(
		<ScheduleTextField
			value={{ every: { n: 5, unit: "days" }, timezone: "UTC" }}
			draft={draft}
			readOnly={readOnly}
			savedTiming={{ enabled: false, saved: null, lastTickAt: null }}
			timezones={{
				display: { zone: "UTC", source: "device" },
				account: null,
				org: null,
				newSchedule: "Europe/Berlin",
			}}
			onDraft={() => events.push("draft")}
			onChange={() => events.push("change")}
		/>,
	);
	expect(events).toEqual([]);
	return html;
}

test("schedule field renders uncommitted empty, partial and malformed drafts verbatim", () => {
	for (const draft of ["", "every monday", "nope", "every 3 minutes"]) {
		const html = renderDraft(draft);
		expect(html).toContain(`value="${draft}"`);
		const parsed = parseScheduleText(draft);
		if (!parsed.ok && parsed.reason !== "empty") {
			const message = renderToStaticMarkup(<span>{parsed.message}</span>);
			expect(html).toContain(message.slice("<span>".length, -"</span>".length));
		}
	}
});

test("next-run metadata uses the semantic caption owner", () => {
	expect(renderDraft("every 5 days")).toMatch(
		/<span data-type-role="caption">Next /,
	);
});

test("ambiguous schedule retains token tones and both parser fixes", () => {
	const html = renderDraft("every month on the 31st");
	expect(html).toContain('data-token-tone="warn"');
	expect(html).toContain("Five months have no 31st.");
	expect(html).toContain("Skip those months");
	expect(html).toContain("Run on the 28th instead");
});

test("readonly schedule keeps the draft and error but omits actionable fixes", () => {
	const html = renderDraft("every month on the 31st", true);
	expect(html).toContain('value="every month on the 31st"');
	expect(html).toContain("readOnly");
	expect(html).toContain("Five months have no 31st.");
	expect(html).not.toContain("<button");
});
