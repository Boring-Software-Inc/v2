import {
	ACTION_CATALOG,
	GATE_CATALOG,
	RULE_CATALOG,
	TRIGGER_CATALOG,
} from "@tripwire/contracts";
import { createDb, repoServices, seedWorkflowCatalog } from "@tripwire/db";

/**
 * Seed a full CATALOG of workflows onto a repo — one per rule, gate, and
 * trigger — so the grid/editor have real graphs to explore and the
 * `workflow-existing` e2e has something to chew on. Everything is created
 * DISABLED (§4: enabling is a deliberate act — seeding must never change what
 * a repo enforces). Idempotent: an existing workflow with the same name is
 * left alone.
 *
 *   bun run scripts/seed-workflows.ts <owner/repo>
 */

const repoFullName = process.argv[2];
if (!repoFullName) {
	console.error("usage: bun run scripts/seed-workflows.ts <owner/repo>");
	process.exit(2);
}

const { db, pool } = createDb();
const repo = await repoServices.getRepoByFullName(db, repoFullName, "github");
if (!repo) {
	console.error(`repo ${repoFullName} is not in the DB`);
	await pool.end();
	process.exit(1);
}
const { created, total } = await seedWorkflowCatalog(db, repo.id);
console.log(
	`seeded ${created} workflows onto ${repoFullName} (${total - created} already present) — ALL DISABLED; enable in the grid`,
);
console.log(
	`catalog: ${RULE_CATALOG.length} rules, ${GATE_CATALOG.length} gates, ${TRIGGER_CATALOG.filter((t) => t.toolbox).length} triggers · action kinds available: ${ACTION_CATALOG.length}`,
);
await pool.end();
