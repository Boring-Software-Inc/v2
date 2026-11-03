/**
 * The ONLY id source in the repo (AGENTS.md). UUIDv7 — time-sortable, so the
 * event store gets index locality (spec §2). Never `crypto.randomUUID`, never
 * nanoid, never a raw uuid lib.
 *
 * Bun's native generator is the fast path; the web head's nitro dev runtime
 * is Node, so a portable RFC 9562 v7 fallback lives beside it.
 */
export function generateId(): string {
	if (globalThis.Bun !== undefined) {
		return globalThis.Bun.randomUUIDv7();
	}
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const ts = BigInt(Date.now());
	for (let i = 0; i < 6; i++) {
		bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
	}
	const view = new DataView(bytes.buffer);
	view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x70);
	view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80);
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
