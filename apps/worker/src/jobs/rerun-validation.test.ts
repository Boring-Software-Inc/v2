import { expect, test } from "bun:test";
import pino from "pino";
import { rerunChangeRequest } from "./rerun.ts";

test("malformed re-run jobs are refused before database or forge access", async () => {
	const deps = {
		db: new Proxy(
			{},
			{
				get() {
					throw new Error("database accessed");
				},
			},
		),
		pool: new Proxy(
			{},
			{
				get() {
					throw new Error("pool accessed");
				},
			},
		),
		logger: pino({ level: "silent" }),
		resolveForge: () => {
			throw new Error("forge accessed");
		},
	} as never;
	for (const forge of ["unknown", "gitcafe", [], 1, null]) {
		await expect(
			rerunChangeRequest(deps, {
				forge,
				repoFullName: "owner/repo",
				number: 1,
				requestedBy: "legacy-user",
				runId: "legacy-run",
			} as never),
		).resolves.toBeUndefined();
	}
	await expect(
		rerunChangeRequest(deps, {
			repoFullName: "owner/repo",
			number: 1,
			requestedBy: "legacy-user",
		}),
	).resolves.toBeUndefined();
});

test("the queue contract admits active forges and legacy claims only", async () => {
	const { rerunChangeRequestJobSchema } = await import("@tripwire/contracts");
	const job = {
		repoFullName: "owner/repo",
		number: 1,
		requestedBy: "legacy-user",
	};
	for (const forge of ["github", "opengit"]) {
		expect(
			rerunChangeRequestJobSchema.safeParse({ ...job, forge }).success,
		).toBe(true);
	}
	expect(
		rerunChangeRequestJobSchema.safeParse({ ...job, runId: "legacy-run" })
			.success,
	).toBe(true);
	for (const invalid of [
		job,
		{ ...job, forge: null },
		{ ...job, forge: "gitcafe" },
		{ ...job, forge: "github", number: 0 },
		{ ...job, forge: "github", repoFullName: "repo" },
		{ ...job, forge: "github", requestedBy: "" },
	]) {
		expect(rerunChangeRequestJobSchema.safeParse(invalid).success).toBe(false);
	}
});
