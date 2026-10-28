import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CaughtCount } from "./caught-count";

describe("CaughtCount", () => {
	test("a count of 0 shows nothing", () => {
		expect(renderToStaticMarkup(<CaughtCount count={0} />)).toBe("");
		expect(renderToStaticMarkup(<CaughtCount count={null} />)).toBe("");
	});

	test("a count above 0 says what it would have caught", () => {
		expect(renderToStaticMarkup(<CaughtCount count={6} />)).toContain(
			"Would have caught 6",
		);
	});
});
