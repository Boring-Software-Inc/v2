import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET = 5 * 1024;
const MARKER = "tripwire.ghost-runner.best";
const dir = join(import.meta.dirname, "..", ".output", "public", "assets");

let files: string[];
try {
	files = readdirSync(dir).filter((name) => name.endsWith(".js"));
} catch {
	console.error(`No build output at ${dir}. Run vite build first.`);
	process.exit(1);
}

const holders = files.filter((name) =>
	readFileSync(join(dir, name), "utf8").includes(MARKER),
);

if (holders.length !== 1) {
	console.error(
		`Expected the ghost game in exactly one lazy chunk, found ${holders.length}: ${holders.join(", ")}`,
	);
	process.exit(1);
}

const chunk = holders[0] as string;
const raw = readFileSync(join(dir, chunk));
const gz = gzipSync(raw).length;
const entries = files.filter((name) => {
	const text = readFileSync(join(dir, name), "utf8");
	return text.includes("registerRunnerHost") || text.includes("Poke the ghost");
});

if (entries.includes(chunk)) {
	console.error(`The ghost game landed in an eagerly loaded chunk: ${chunk}`);
	process.exit(1);
}

console.log(
	`ghost game chunk ${chunk}: ${raw.length} B raw, ${gz} B gzip (budget ${BUDGET} B)`,
);
if (gz > BUDGET) {
	console.error("The ghost game chunk is over its gzip budget.");
	process.exit(1);
}
