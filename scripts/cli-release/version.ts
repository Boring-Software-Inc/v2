export type Bump = "patch" | "minor" | "major";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function isRelease(version: string): boolean {
	return SEMVER.test(version.trim());
}

export function parseVersion(version: string): [number, number, number] {
	const match = SEMVER.exec(version.trim());
	if (!match) {
		throw new Error(`Not a release version: ${version}`);
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function nextVersion(current: string, bump: Bump | string): string {
	if (SEMVER.test(bump)) {
		const [a, b, c] = parseVersion(bump);
		if (compareVersions(`${a}.${b}.${c}`, current) <= 0) {
			throw new Error(`${bump} is not newer than ${current}`);
		}
		return bump;
	}
	const [major, minor, patch] = parseVersion(current);
	switch (bump) {
		case "major":
			return `${major + 1}.0.0`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "patch":
			return `${major}.${minor}.${patch + 1}`;
		default:
			throw new Error(`Bump must be patch, minor, major or x.y.z, got ${bump}`);
	}
}

export function compareVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	for (let i = 0; i < 3; i++) {
		const diff = (left[i] ?? 0) - (right[i] ?? 0);
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
}

export function stagingVersion(
	current: string,
	bump: Bump | string,
	sequence: string,
): string {
	if (!/^[1-9]\d*$/.test(sequence)) {
		throw new Error("Staging release sequence must be a positive integer");
	}
	return `${nextVersion(current, bump)}-staging.${sequence}`;
}
