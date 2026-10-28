import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
	compareVersions,
	isRelease,
	nextVersion,
	stagingVersion,
} from "./version.ts";

const bump = process.argv[2];
const channel = process.argv.includes("--staging") ? "staging" : "latest";
if (!bump) {
	process.stderr.write(
		"Usage: bun run cli:release <patch|minor|major|x.y.z> [--staging] [--dry-run]\n",
	);
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
const next =
	channel === "staging"
		? stagingVersion(base, bump, String(Date.now()))
		: nextVersion(base, bump);
process.stdout.write(
	`published ${published ?? "none"}, next ${next} (${channel})\n`,
);

if (process.argv.includes("--dry-run")) {
	process.exit(0);
}

const run = spawnSync(
	"gh",
	[
		"workflow",
		"run",
		"release-cli.yml",
		"--ref",
		channel === "staging" ? "staging" : "main",
		"-f",
		`bump=${bump}`,
		...(channel === "staging" ? ["-f", "channel=staging"] : []),
	],
	{ stdio: "inherit" },
);
if (run.status !== 0) {
	process.exit(run.status ?? 1);
}
process.stdout.write(
	"Started the release workflow. Watch it with: gh run watch\n",
);
