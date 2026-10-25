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

async function startContainer(): Promise<{ name: string; port: string }> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		const name = `tripwire-test-${generateId().slice(0, 13)}`;
		try {
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
			const portLine = await run(["docker", "port", name, "5432/tcp"]);
			const port = portLine.split("\n")[0]?.split(":").at(-1);
			if (!port) {
				throw new Error(`could not determine mapped port for ${name}`);
			}
			return { name, port };
		} catch (error) {
			lastError = error;
			await run(["docker", "rm", "-f", name]).catch(() => undefined);
			await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
		}
	}
	throw lastError;
}

export async function createTestDatabase(): Promise<TestDatabase> {
	const { name, port } = await startContainer();
	const url = `postgres://test:test@localhost:${port}/test`;

	const { Pool } = await import("pg");
	const deadline = Date.now() + 60_000;
	for (;;) {
		const pool = new Pool({ connectionString: url, max: 1 });
		try {
			await pool.query("select 1");
			await pool.end();
			break;
		} catch {
			await pool.end().catch(() => undefined);
			if (Date.now() > deadline) {
				await run(["docker", "rm", "-f", name]).catch(() => undefined);
				throw new Error(`test postgres ${name} never became ready`);
			}
			await new Promise((r) => setTimeout(r, 300));
		}
	}

	return {
		url,
		stop: async () => {
			await run(["docker", "rm", "-f", name]).catch(() => undefined);
		},
	};
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
