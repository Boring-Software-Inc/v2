import type { RepoLabel } from "@tripwire/contracts";

export interface LabelOption {
	name: string;
	color: string | null;
	synced: boolean;
}

export function labelOptions(
	synced: readonly RepoLabel[],
	saved: readonly string[],
): LabelOption[] {
	const known = new Map(
		synced.map((label) => [label.name.toLowerCase(), label] as const),
	);
	const options: LabelOption[] = synced.map((label) => ({
		name: label.name,
		color: label.color,
		synced: true,
	}));
	const seen = new Set(known.keys());
	for (const name of saved) {
		const key = name.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			options.push({ name, color: null, synced: false });
		}
	}
	return options;
}

export function labelColor(
	options: readonly LabelOption[],
	name: string,
): string | null {
	return (
		options.find((option) => option.name.toLowerCase() === name.toLowerCase())
			?.color ?? null
	);
}
