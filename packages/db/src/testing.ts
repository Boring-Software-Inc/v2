import { DEFAULT_WORKFLOW } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import type { Db } from "./client.ts";
import { upsertRuleConfig } from "./services/repos.ts";

/**
 * §11 integration machinery: a REAL throwaway Postgres container per test
 * suite, managed via the docker CLI. (testcontainers-node hangs under Bun —
 * its dockerode log/stream plumbing never resolves `start()`; see
 * DECISIONS.md. Same guarantee, zero deps: never mock Postgres.)
 */
export interface TestDatabase {
	url: string;
	stop(): Promise<void>;
}

async function run(cmd: string[]): Promise<string> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const [out, err] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if ((await proc.exited) !== 0) {
		throw new Error(`${cmd.join(" ")} failed: ${err}`);
	}
	return out.trim();
}

async function startContainer(name: string): Promise<void> {
	await run([
		"docker",
		"run",
		"-d",
		"--rm",
		"--name",
		name,
		"-e",
		"POSTGRES_USER=test",
		"-e",
		"POSTGRES_PASSWORD=test",
		"-e",
		"POSTGRES_DB=test",
		"-p",
		"0:5432",
		"postgres:17-alpine",
	]);
}

async function waitForPostgres(name: string, url: string): Promise<void> {
	const { Pool } = await import("pg");
	const pool = new Pool({
		connectionString: url,
		connectionTimeoutMillis: 1_000,
		max: 1,
		query_timeout: 1_000,
	});
	const deadline = performance.now() + 18_000;
	try {
		for (;;) {
			try {
				await pool.query("select 1");
				return;
			} catch (error) {
				if (performance.now() >= deadline) {
					throw new Error(`test postgres ${name} never became ready`, {
						cause: error,
					});
				}
				await Bun.sleep(300);
			}
		}
	} finally {
		await pool.end();
	}
}

export async function createTestDatabase(): Promise<TestDatabase> {
	const failures: unknown[] = [];
	for (let attempt = 0; attempt < 3; attempt++) {
		const name = `tripwire-test-${generateId()}`;
		const stop = async () => {
			await run(["docker", "rm", "-f", name]).catch(() => undefined);
		};
		try {
			await startContainer(name);
			const portLine = await run(["docker", "port", name, "5432/tcp"]);
			const port = portLine.split("\n")[0]?.split(":").at(-1);
			if (!port) {
				throw new Error(`could not determine mapped port for ${name}`);
			}
			const url = `postgres://test:test@localhost:${port}/test`;
			await waitForPostgres(name, url);
			return { url, stop };
		} catch (error) {
			failures.push(error);
			await stop();
		}
	}
	throw new AggregateError(
		failures,
		"Could not start a test Postgres database",
	);
}

export async function turnOnLegacyRules(db: Db, repoId: string): Promise<void> {
	for (const node of DEFAULT_WORKFLOW.nodes) {
		if (node.type !== "rule") {
			continue;
		}
		const [ruleId = node.ref, version = "1"] = node.ref.split("@");
		await upsertRuleConfig(db, repoId, {
			ruleId,
			version: Number(version),
			enabled: true,
			config: node.config,
		});
	}
}
