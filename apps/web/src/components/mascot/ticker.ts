export type Tickable = {
	tick: (dt: number) => void;
	setPointer: (p: { x: number; y: number } | null) => void;
};

type Entry = {
	target: Tickable;
	el: Element | null;
	far: number;
	visible: boolean;
	aimed: boolean;
};

const REACH = 260;
const DEFAULT_FAR = 1100;
const TOUCH_RELAX_MS = 1600;
const MAX_DT = 0.05;

const entries = new Set<Entry>();
const byElement = new Map<Element, Entry>();
let observer: IntersectionObserver | null = null;
let frame = 0;
let last = 0;
let pointer: { x: number; y: number } | null = null;
let relax = 0;
let listening = false;

function wanted() {
	if (document.visibilityState !== "visible") {
		return false;
	}
	for (const entry of entries) {
		if (entry.visible) {
			return true;
		}
	}
	return false;
}

function aim(entry: Entry) {
	if (!entry.el) {
		return;
	}
	if (!pointer) {
		if (entry.aimed) {
			entry.aimed = false;
			entry.target.setPointer(null);
		}
		return;
	}
	const box = entry.el.getBoundingClientRect();
	const dx = pointer.x - (box.left + box.width / 2);
	const dy = pointer.y - (box.top + box.height / 2);
	const distance = Math.hypot(dx, dy);
	if (distance > entry.far) {
		if (entry.aimed) {
			entry.aimed = false;
			entry.target.setPointer(null);
		}
		return;
	}
	const scale = distance > REACH ? 1 / distance : 1 / REACH;
	entry.aimed = true;
	entry.target.setPointer({ x: dx * scale, y: dy * scale });
}

function loop(now: number) {
	const dt = Math.min(MAX_DT, (now - last) / 1000);
	last = now;
	for (const entry of entries) {
		if (entry.visible) {
			aim(entry);
			entry.target.tick(dt);
		}
	}
	frame = wanted() ? requestAnimationFrame(loop) : 0;
}

function wake() {
	if (frame || !wanted()) {
		return;
	}
	last = performance.now();
	frame = requestAnimationFrame(loop);
}

function onMove(event: PointerEvent) {
	pointer = { x: event.clientX, y: event.clientY };
	window.clearTimeout(relax);
	if (event.pointerType === "touch") {
		relax = window.setTimeout(() => {
			pointer = null;
		}, TOUCH_RELAX_MS);
	}
}

function onLeave(event: PointerEvent) {
	if (!event.relatedTarget) {
		pointer = null;
	}
}

function onVisibility() {
	if (document.visibilityState === "visible") {
		wake();
	} else {
		cancelAnimationFrame(frame);
		frame = 0;
	}
}

function listen(on: boolean) {
	if (on === listening) {
		return;
	}
	listening = on;
	if (on) {
		window.addEventListener("pointermove", onMove, { passive: true });
		window.addEventListener("pointerdown", onMove, { passive: true });
		document.documentElement.addEventListener("pointerleave", onLeave);
		document.addEventListener("visibilitychange", onVisibility);
		return;
	}
	window.removeEventListener("pointermove", onMove);
	window.removeEventListener("pointerdown", onMove);
	document.documentElement.removeEventListener("pointerleave", onLeave);
	document.removeEventListener("visibilitychange", onVisibility);
}

function observe(entry: Entry) {
	if (!entry.el) {
		return;
	}
	if (!observer) {
		observer = new IntersectionObserver((records) => {
			for (const record of records) {
				const found = byElement.get(record.target);
				if (found) {
					found.visible = record.isIntersecting;
				}
			}
			wake();
		});
	}
	byElement.set(entry.el, entry);
	observer.observe(entry.el);
}

export function trackMascot(
	target: Tickable,
	el?: Element,
	far = DEFAULT_FAR,
): () => void {
	const entry: Entry = {
		target,
		el: el ?? null,
		far,
		visible: !el,
		aimed: false,
	};
	entries.add(entry);
	listen(true);
	observe(entry);
	wake();
	return () => {
		entries.delete(entry);
		if (entry.el) {
			byElement.delete(entry.el);
			observer?.unobserve(entry.el);
		}
		if (entries.size === 0) {
			listen(false);
			observer?.disconnect();
			observer = null;
			cancelAnimationFrame(frame);
			frame = 0;
			pointer = null;
		}
	};
}
