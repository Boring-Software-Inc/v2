/**
 * The ONLY id source in the repo (AGENTS.md). UUIDv7 — time-sortable, so the
 * event store gets index locality (spec §2). Never `crypto.randomUUID`, never
 * nanoid, never a raw uuid lib.
 *
 * Bun's native generator is the fast path; the web head's nitro dev runtime
 * is Node, so a portable RFC 9562 v7 fallback lives beside it.
 */
export function generateId(): string {
	if (typeof Bun !== "undefined") {
		return Bun.randomUUIDv7();
	}
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const ts = BigInt(Date.now());
	for (let i = 0; i < 6; i++) {
		bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
	}
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
