import { describe, expect, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";
import { signOutMutationOptions } from "#/hooks/use-sign-out";

function signOutHarness(request: () => Promise<Response>) {
	const queryClient = new QueryClient();
	const requests: { path: string; method: string | undefined }[] = [];
	const client = createAuthClient({
		baseURL: "https://tripwire.test",
		fetchOptions: {
			customFetchImpl: async (input, init) => {
				requests.push({
					path: new URL(String(input)).pathname,
					method: init?.method,
				});
				return request();
			},
		},
	});
	const destinations: string[] = [];
	const failures: string[] = [];
	const cached = { user: { accessStatus: "pending" } };
	queryClient.setQueryData(["auth", "session"], cached);
	queryClient.setQueryData(["auth", "current-user"], cached.user);
	queryClient.setQueryData(["account", "sessions"], ["current-session"]);
	queryClient.setQueryData(["orgs"], ["private-org"]);
	const observer = new MutationObserver(
		queryClient,
		signOutMutationOptions(queryClient, {
			signOut: () => client.signOut(),
			go: (url) => {
				expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
				expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
				destinations.push(url);
			},
			fail: (message) => failures.push(message),
		}),
	);
	return { queryClient, requests, destinations, failures, cached, observer };
}

describe("current-session sign-out", () => {
	test("clears auth and private caches before leaving the queue for login", async () => {
		const harness = signOutHarness(async () =>
			Response.json({ success: true }),
		);
		await harness.observer.mutate();
		expect(harness.requests).toEqual([
			{ path: "/api/auth/sign-out", method: "POST" },
		]);
		expect(harness.destinations).toEqual(["/login"]);
		expect(harness.failures).toEqual([]);
		expect(harness.queryClient.getQueryCache().getAll()).toHaveLength(0);
	});

	test("waits for server success, then cancels queries so late results cannot restore private data", async () => {
		let confirmSignOut: ((response: Response) => void) | undefined;
		const response = new Promise<Response>((resolve) => {
			confirmSignOut = resolve;
		});
		const harness = signOutHarness(() => response);
		let querySignal: AbortSignal | undefined;
		let finishQuery: ((data: string[]) => void) | undefined;
		const query = harness.queryClient.fetchQuery({
			queryKey: ["orgs"],
			queryFn: ({ signal }) => {
				querySignal = signal;
				return new Promise<string[]>((resolve) => {
					finishQuery = resolve;
				});
			},
		});
		const queryResult = query.then(
			() => "completed",
			() => "cancelled",
		);
		const signingOut = harness.observer.mutate();
		await Promise.resolve();
		expect(
			harness.queryClient.getQueryData<typeof harness.cached>([
				"auth",
				"session",
			]),
		).toBe(harness.cached);
		expect(harness.destinations).toEqual([]);
		expect(querySignal?.aborted).toBe(false);
		confirmSignOut?.(Response.json({ success: true }));
		await signingOut;
		expect(await queryResult).toBe("cancelled");
		expect(querySignal?.aborted).toBe(true);
		finishQuery?.(["late-private-org"]);
		await Promise.resolve();
		expect(harness.queryClient.getQueryCache().getAll()).toHaveLength(0);
		expect(harness.destinations).toEqual(["/login"]);
	});

	test("keeps the session and page when the server rejects sign-out", async () => {
		const harness = signOutHarness(async () =>
			Response.json({ message: "Unavailable" }, { status: 503 }),
		);
		await expect(harness.observer.mutate()).rejects.toThrow();
		expect(harness.requests).toHaveLength(1);
		expect(harness.destinations).toEqual([]);
		expect(harness.failures).toEqual([
			"Tripwire could not sign you out. Try again.",
		]);
		expect(
			harness.queryClient.getQueryData<typeof harness.cached>([
				"auth",
				"session",
			]),
		).toBe(harness.cached);
		expect(harness.queryClient.getQueryData<string[]>(["orgs"])).toEqual([
			"private-org",
		]);
	});

	test("keeps the session and reports network failures without navigating", async () => {
		const harness = signOutHarness(async () => {
			throw new TypeError("Network unavailable");
		});
		await expect(harness.observer.mutate()).rejects.toThrow();
		expect(harness.requests).toHaveLength(1);
		expect(harness.destinations).toEqual([]);
		expect(harness.failures).toEqual([
			"Tripwire could not sign you out. Try again.",
		]);
		expect(
			harness.queryClient.getQueryData<typeof harness.cached>([
				"auth",
				"session",
			]),
		).toBe(harness.cached);
		expect(
			harness.queryClient.getQueryData<string[]>(["account", "sessions"]),
		).toEqual(["current-session"]);
	});
});
