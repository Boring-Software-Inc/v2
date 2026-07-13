import { describe, expect, test } from "bun:test";
import { assertDevLoginAllowed, isLoopbackHost } from "./guard.ts";

/**
 * The dev-login guard is the runtime half of the §13 security (the compile-time
 * half is `import.meta.env.DEV`, which excludes the code from prod). It must
 * throw for a production build and for any non-loopback host.
 */

describe("assertDevLoginAllowed", () => {
	test("throws when not a dev build (production)", () => {
		expect(() =>
			assertDevLoginAllowed({ isDev: false, host: "localhost:3000" }),
		).toThrow(/disabled outside a dev build/);
	});

	test("throws for a non-localhost host even in dev", () => {
		expect(() =>
			assertDevLoginAllowed({ isDev: true, host: "tripwire.dev" }),
		).toThrow(/non-local host/);
		expect(() =>
			assertDevLoginAllowed({ isDev: true, host: "10.0.0.5:3000" }),
		).toThrow(/non-local host/);
	});

	test("throws when the host header is absent", () => {
		expect(() => assertDevLoginAllowed({ isDev: true, host: null })).toThrow();
	});

	test("allows a loopback dev request", () => {
		expect(() =>
			assertDevLoginAllowed({ isDev: true, host: "localhost:3000" }),
		).not.toThrow();
		expect(() =>
			assertDevLoginAllowed({ isDev: true, host: "127.0.0.1:3000" }),
		).not.toThrow();
	});
});

describe("isLoopbackHost", () => {
	test("recognises loopback names and addresses", () => {
		expect(isLoopbackHost("localhost")).toBe(true);
		expect(isLoopbackHost("localhost:3000")).toBe(true);
		expect(isLoopbackHost("127.0.0.1:8080")).toBe(true);
		expect(isLoopbackHost("[::1]:3000")).toBe(true);
	});
	test("rejects remote hosts and blanks", () => {
		expect(isLoopbackHost("example.com")).toBe(false);
		expect(isLoopbackHost("192.168.1.9:3000")).toBe(false);
		expect(isLoopbackHost(null)).toBe(false);
		expect(isLoopbackHost(undefined)).toBe(false);
	});
});
