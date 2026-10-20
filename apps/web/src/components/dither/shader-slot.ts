type Entry = { priority: number; order: number; visible: boolean };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let counter = 0;
let winner: string | null = null;

function recompute() {
	let best: [string, Entry] | null = null;
	for (const pair of entries) {
		const [, entry] = pair;
		if (!entry.visible) {
			continue;
		}
		if (
			!best ||
			entry.priority > best[1].priority ||
			(entry.priority === best[1].priority && entry.order < best[1].order)
		) {
			best = pair;
		}
	}
	const next = best ? best[0] : null;
	if (next !== winner) {
		winner = next;
		for (const listener of listeners) {
			listener();
		}
	}
}

export function setShaderSlot(id: string, priority: number, visible: boolean) {
	const existing = entries.get(id);
	entries.set(id, {
		priority,
		visible,
		order: existing?.order ?? counter++,
	});
	recompute();
}

export function releaseShaderSlot(id: string) {
	entries.delete(id);
	recompute();
}

export function subscribeShaderSlot(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function shaderSlotWinner() {
	return winner;
}
