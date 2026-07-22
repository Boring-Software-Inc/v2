/**
 * A tiny external store bridging the module-singleton toast controller to the
 * mounted <ToastAnnouncer> aria-live region. The controller pushes the text a
 * re-fire should speak; the region renders it so screen readers re-read the
 * repeat (the count) that the bounce only conveys visually.
 *
 * `seq` increments on every push so React always commits — the region's text
 * changes on each re-fire (the count climbs), which is what triggers the
 * polite re-announcement.
 */

interface AnnouncementState {
	text: string;
	seq: number;
}

let state: AnnouncementState = { text: "", seq: 0 };
const listeners = new Set<() => void>();

export function pushAnnouncement(text: string): void {
	state = { text, seq: state.seq + 1 };
	for (const listener of listeners) {
		listener();
	}
}

export function subscribeAnnouncement(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getAnnouncementSnapshot(): AnnouncementState {
	return state;
}

/** Test seam — reset between cases. */
export function resetAnnouncerForTest(): void {
	state = { text: "", seq: 0 };
	listeners.clear();
}
