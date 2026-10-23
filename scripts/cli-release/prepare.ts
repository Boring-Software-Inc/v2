import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { compareVersions, isRelease, nextVersion } from "./version.ts";

const PACKAGE = "@tripwire-sh/cli";
const MANIFEST = new URL("../../apps/cli/package.json", import.meta.url);

async function publishedVersion(): Promise<string | null> {
	const response = await fetch(
		`https://registry.npmjs.org/${PACKAGE.replace("/", "%2f")}`,
	);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`npm registry returned ${response.status}`);
	}
	const body = (await response.json()) as { "dist-tags"?: { latest?: string } };
	return body["dist-tags"]?.latest ?? null;
}

const [mode, arg] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
	version: string;
};
const published = await publishedVersion();
const base =
	published &&
	isRelease(published) &&
	compareVersions(published, manifest.version) > 0
		? published
		: manifest.version;

let version: string;
if (mode === "bump") {
	version = nextVersion(base, arg ?? "patch");
} else if (mode === "tag") {
	version = (arg ?? "").replace(/^cli-v/, "");
	if (
		published &&
		isRelease(published) &&
		compareVersions(version, published) <= 0
	) {
		throw new Error(
			`cli-v${version} is not newer than the published ${published}`,
		);
	}
} else {
	throw new Error(
		"Usage: prepare.ts bump <patch|minor|major|x.y.z> | tag <cli-vX.Y.Z>",
	);
}

manifest.version = version;
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, "\t")}\n`);
console.log(`published ${published ?? "none"}, releasing ${version}`);
if (process.env.GITHUB_OUTPUT) {
	appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
}
