import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

describe("generateId Node fallback", () => {
	test("encodes the timestamp, version and variant over random bytes", () => {
		const output = execFileSync(
			"node",
			[
				"--experimental-strip-types",
				"--input-type=module",
				"-e",
				`
					import { generateId } from ${JSON.stringify(new URL("./id.ts", import.meta.url).href)};
					Date.now = () => 0x0123456789ab;
					crypto.getRandomValues = (bytes) => bytes.fill(255);
					process.stdout.write(generateId());
				`,
			],
			{ encoding: "utf8" },
		);
		expect(output).toBe("01234567-89ab-7fff-bfff-ffffffffffff");
	});

	test("retains random entropy and sorts by millisecond timestamp", () => {
		const output = execFileSync(
			"node",
			[
				"--experimental-strip-types",
				"--input-type=module",
				"-e",
				`
					import { generateId } from ${JSON.stringify(new URL("./id.ts", import.meta.url).href)};
					Date.now = () => 0x0123456789ab;
					const ids = Array.from({ length: 32 }, () => generateId());
					Date.now = () => 0x0123456789ac;
					ids.push(generateId());
					process.stdout.write(ids.join("\\n"));
				`,
			],
			{ encoding: "utf8" },
		);
		const ids = output.split("\n");
		expect(ids).toHaveLength(33);
		expect(new Set(ids).size).toBe(33);
		for (const id of ids.slice(0, 32)) {
			expect(id).toMatch(
				/^01234567-89ab-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
			);
			expect(id < (ids.at(-1) ?? "")).toBe(true);
		}
		expect(ids.at(-1)).toMatch(/^01234567-89ac-7/);
	});
});
