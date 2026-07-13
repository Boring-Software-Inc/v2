/**
 * `bun run dev:demo` (§13) — a fully seeded, presentable app for showing the
 * product, the WEB HEAD ONLY. No Docker, no worker, no api, no queue: a demo
 * never processes a webhook, it looks at a dashboard with a story in it.
 *
 * The database is embedded PGlite (WASM Postgres, in-process) at `.demo/pgdata`
 * — the SAME Drizzle schema and SAME generated migrations as prod, so there is
 * no second dialect and no drift. We seed the story here (one process owns the
 * PGlite dir), close it, then hand the dir to the vite dev server. Re-running
 * resets to the same clean story (idempotent).
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
	applyPgliteMigrations,
	createPgliteDb,
	ensureDemoRepo,
	resetDemoData,
	seedPublicRun,
	seedStory,
} from "@tripwire/db";

const DATA_DIR = join(process.cwd(), ".demo", "pgdata");
// A fixed dev secret flips auth to "enabled" so the gates (onboarding, the
// public-run stranger view) actually function and the persona switcher works.
const DEV_SECRET = "tripwire-dev-demo-secret";

async function seed(): Promise<void> {
	const { db, client } = createPgliteDb(DATA_DIR);
	await applyPgliteMigrations(client);
	await resetDemoData(db);
	const now = new Date();
	// The active dashboard story — the same repo the "active" persona uses, so
	// auto-login lands straight on a populated dashboard.
	const repo = await ensureDemoRepo(db, "active-webapp", {
		installationId: "demo-inst-active",
		private: false,
	});
	await seedStory(db, repo, now);
	// A public repo + run so the "anonymous" persona (and any /runs/:id link)
	// shows the stranger's public view.
	const pub = await ensureDemoRepo(db, "public-oss", { private: false });
	await seedPublicRun(db, pub, now);
	await client.close();
}

await seed();
process.stdout.write(
	"demo seeded → starting web head at http://localhost:3000 (no docker, no worker)\n",
);

const child = spawn("bun", ["--filter", "@tripwire/web", "dev"], {
	stdio: "inherit",
	env: {
		...process.env,
		PGLITE_DATA_DIR: DATA_DIR,
		BETTER_AUTH_SECRET: DEV_SECRET,
		BETTER_AUTH_URL: "http://localhost:3000",
		NODE_ENV: "development",
	},
});
child.on("exit", (code) => process.exit(code ?? 0));
