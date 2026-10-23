import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { compareVersions, isRelease, nextVersion } from "./version.ts";

const bump = process.argv[2];
if (!bump) {
	console.error("Usage: bun run cli:release <patch|minor|major|x.y.z>");
	process.exit(1);
}

const manifest = JSON.parse(
	readFileSync(new URL("../../apps/cli/package.json", import.meta.url), "utf8"),
) as { version: string };
const response = await fetch("https://registry.npmjs.org/@tripwire-sh%2fcli");
const published = response.ok
	? ((await response.json()) as { "dist-tags"?: { latest?: string } })[
			"dist-tags"
		]?.latest
	: undefined;
const base =
	published &&
	isRelease(published) &&
	compareVersions(published, manifest.version) > 0
		? published
		: manifest.version;
const next = nextVersion(base, bump);
console.log(`published ${published ?? "none"}, next ${next}`);

if (process.argv.includes("--dry-run")) {
	process.exit(0);
}

const run = spawnSync(
	"gh",
	["workflow", "run", "release-cli.yml", "--ref", "main", "-f", `bump=${bump}`],
	{ stdio: "inherit" },
);
if (run.status !== 0) {
	process.exit(run.status ?? 1);
}
console.log("Started the release workflow. Watch it with: gh run watch");
