/**
 * Generated workflow names (§workflows grid) — paper.design style
 * adjective+noun ("brave-lantern"). Pure and seedable so collision-retry
 * behavior is unit-testable; the DB service owns the retry loop against
 * existing names.
 */

const ADJECTIVES = [
	"amber",
	"bold",
	"brave",
	"bright",
	"brisk",
	"calm",
	"clever",
	"cosmic",
	"crimson",
	"curious",
	"daring",
	"deft",
	"dusty",
	"eager",
	"early",
	"fabled",
	"fleet",
	"gentle",
	"gilded",
	"hardy",
	"hidden",
	"humble",
	"iron",
	"keen",
	"lively",
	"lunar",
	"mellow",
	"misty",
	"nimble",
	"noble",
	"patient",
	"quiet",
	"rapid",
	"rustic",
	"sable",
	"solar",
	"steady",
	"swift",
	"tidy",
	"wild",
] as const;

const NOUNS = [
	"anchor",
	"anvil",
	"badger",
	"beacon",
	"bridge",
	"canyon",
	"comet",
	"compass",
	"crane",
	"ember",
	"falcon",
	"fern",
	"fjord",
	"garnet",
	"glacier",
	"harbor",
	"heron",
	"kestrel",
	"lantern",
	"lighthouse",
	"marble",
	"meadow",
	"meteor",
	"orchard",
	"otter",
	"pebble",
	"pine",
	"prairie",
	"quarry",
	"raven",
	"reef",
	"ridge",
	"river",
	"sparrow",
	"summit",
	"thicket",
	"tundra",
	"walnut",
	"willow",
	"wren",
] as const;

/** Deterministic PRNG (mulberry32) so tests can force collisions. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface GenerateNameOptions {
	/** Seed for deterministic output (tests). Unset ⇒ time+random seeded. */
	seed?: number;
}

/** One candidate name, e.g. "brave-lantern". */
export function generateWorkflowName(
	options: GenerateNameOptions = {},
): string {
	const rand =
		options.seed !== undefined
			? mulberry32(options.seed)
			: mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
	const adjective = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)];
	const noun = NOUNS[Math.floor(rand() * NOUNS.length)];
	return `${adjective}-${noun}`;
}

/**
 * Pick a name not in `taken`: fresh candidates for `retries` rounds, then a
 * numeric-suffix fallback that CANNOT collide-loop (bounded by taken.size).
 */
export function pickWorkflowName(
	taken: ReadonlySet<string>,
	options: GenerateNameOptions & { retries?: number } = {},
): string {
	const retries = options.retries ?? 8;
	const rand =
		options.seed !== undefined
			? mulberry32(options.seed)
			: mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
	let last = "";
	for (let i = 0; i < retries; i++) {
		const adjective = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)];
		const noun = NOUNS[Math.floor(rand() * NOUNS.length)];
		last = `${adjective}-${noun}`;
		if (!taken.has(last)) {
			return last;
		}
	}
	for (let n = 2; n <= taken.size + 2; n++) {
		const candidate = `${last}-${n}`;
		if (!taken.has(candidate)) {
			return candidate;
		}
	}
	return `${last}-${taken.size + 3}`; // unreachable, kept total
}
