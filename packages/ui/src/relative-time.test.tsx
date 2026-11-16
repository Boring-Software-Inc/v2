import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { formatRelative, RelativeTime } from "./relative-time";

test("invalid timestamps render a readable fallback without date metadata", () => {
	for (const date of ["invalid date", Number.NaN, new Date(Number.NaN)]) {
		const markup = renderToStaticMarkup(
			<RelativeTime
				date={date}
				className="timestamp"
				aria-describedby="reference"
			/>,
		);
		expect(markup).toContain("Unknown time");
		expect(markup).not.toContain("<time");
		expect(markup).toContain('class="timestamp"');
		expect(markup).toContain('aria-describedby="reference"');
		expect(markup).not.toContain("datetime");
		expect(markup).not.toContain("tabindex");
	}
	expect(formatRelative(new Date(Number.NaN))).toBe("Unknown time");
});

test("valid timestamps retain machine-readable and accessible exact time", () => {
	const markup = renderToStaticMarkup(<RelativeTime date={0} />);
	expect(markup).toContain('dateTime="1970-01-01T00:00:00.000Z"');
	expect(markup).toContain('class="sr-only"');
	expect(markup).toContain('tabindex="0"');
	expect(markup).toContain("Jan 1, 1970");
	expect(markup).toContain("12:00:00 AM UTC");
});
