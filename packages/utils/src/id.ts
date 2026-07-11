/**
 * The ONLY id source in the repo (AGENTS.md). UUIDv7 — time-sortable, so the
 * event store gets index locality (spec §2). Never `crypto.randomUUID`, never
 * nanoid, never a raw uuid lib.
 */
export function generateId(): string {
	return Bun.randomUUIDv7();
}
