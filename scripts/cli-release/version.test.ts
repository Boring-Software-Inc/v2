import { describe, expect, test } from "bun:test";
import {
	compareVersions,
	isRelease,
	nextVersion,
	stagingVersion,
} from "./version.ts";

describe("nextVersion", () => {
	test("bumps patch, minor and major", () => {
		expect(nextVersion("0.1.0", "patch")).toBe("0.1.1");
		expect(nextVersion("0.1.7", "minor")).toBe("0.2.0");
		expect(nextVersion("0.9.3", "major")).toBe("1.0.0");
	});

	test("accepts an explicit newer version", () => {
		expect(nextVersion("0.1.0", "0.3.0")).toBe("0.3.0");
	});

	test("rejects an explicit version that is not newer", () => {
		expect(() => nextVersion("0.3.0", "0.3.0")).toThrow();
		expect(() => nextVersion("0.3.0", "0.2.9")).toThrow();
	});

	test("rejects unknown bumps and malformed versions", () => {
		expect(() => nextVersion("0.1.0", "huge")).toThrow();
		expect(() => nextVersion("v0.1", "patch")).toThrow();
	});
});

describe("compareVersions", () => {
	test("orders by major, minor, patch", () => {
		expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
		expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
		expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
	});
});

describe("isRelease", () => {
	test("only plain x.y.z counts as a release", () => {
		expect(isRelease("1.2.3")).toBe(true);
		expect(isRelease("0.0.0-stage")).toBe(false);
	});
});

describe("stagingVersion", () => {
	test("keeps staging out of the stable version space", () => {
		expect(stagingVersion("0.1.0", "patch", "42")).toBe("0.1.1-staging.42");
		expect(stagingVersion("0.1.0", "0.2.0", "43")).toBe("0.2.0-staging.43");
		expect(isRelease(stagingVersion("0.1.0", "patch", "42"))).toBe(false);
	});

	test("rejects malformed sequences", () => {
		for (const sequence of ["", "0", "01", "-1", "1.2", "42\nlatest"]) {
			expect(() => stagingVersion("0.1.0", "patch", sequence)).toThrow();
		}
	});
});
