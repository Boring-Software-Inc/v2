import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The source of the import-free authoring module, read when the CLI is built.
 * Imported as a Bun macro, so the published file carries it as a string.
 */
export function authoringSource(): string {
	const contracts = dirname(
		Bun.resolveSync("@tripwire/contracts", import.meta.dir),
	);
	return readFileSync(join(contracts, "workflow-authoring.ts"), "utf8");
}
