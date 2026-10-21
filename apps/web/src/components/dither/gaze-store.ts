const MAX_OFFSET = 2;
const REACH = 160;
const FAR = 640;
const IDLE_MS = 3000;
const TOUCH_RELAX_MS = 1500;
const BLINK_MS = 140;
const BLINK_MIN_MS = 3500;
const BLINK_SPREAD_MS = 4500;

type GazeElement = HTMLElement | SVGElement;

type Watcher = { el: GazeElement; blink: number };

const watchers = new Map<GazeElement, Watcher>();
let pointer: { x: number; y: number } | null = null;
let frame = 0;
let idle = 0;
let listening = false;

function reducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setGaze(el: GazeElement, x: number, y: number) {
	el.style.setProperty("--gaze-x", x.toFixed(2));
	el.style.setProperty("--gaze-y", y.toFixed(2));
}

function aim() {
	frame = 0;
	for (const { el } of watchers.values()) {
		if (!pointer) {
			setGaze(el, 0, 0);
			continue;
		}
		const box = el.getBoundingClientRect();
		const dx = pointer.x - (box.left + box.width / 2);
		const dy = pointer.y - (box.top + box.height / 2);
		const distance = Math.hypot(dx, dy);
		if (distance > FAR || distance === 0) {
			setGaze(el, 0, 0);
			continue;
		}
		const reach = Math.min(1, distance / REACH) * MAX_OFFSET;
		setGaze(el, (dx / distance) * reach, (dy / distance) * reach);
	}
}

function schedule() {
	if (!frame) {
		frame = requestAnimationFrame(aim);
	}
}

function relaxAfter(ms: number) {
	window.clearTimeout(idle);
	idle = window.setTimeout(() => {
		pointer = null;
		schedule();
	}, ms);
}

function onMove(event: PointerEvent) {
	if (event.pointerType === "touch") {
		return;
	}
	pointer = { x: event.clientX, y: event.clientY };
	schedule();
	relaxAfter(IDLE_MS);
}

function onDown(event: PointerEvent) {
	if (event.pointerType !== "touch") {
		return;
	}
	pointer = { x: event.clientX, y: event.clientY };
	schedule();
	relaxAfter(TOUCH_RELAX_MS);
}

function blinkLater(watcher: Watcher) {
	window.clearTimeout(watcher.blink);
	watcher.blink = window.setTimeout(
		() => {
			watcher.el.dataset.blink = "";
			window.setTimeout(() => {
				delete watcher.el.dataset.blink;
				if (watchers.get(watcher.el) === watcher && listening) {
					blinkLater(watcher);
				}
			}, BLINK_MS);
		},
		BLINK_MIN_MS + Math.random() * BLINK_SPREAD_MS,
	);
}

function start() {
	if (listening || document.visibilityState !== "visible" || reducedMotion()) {
		return;
	}
	listening = true;
	window.addEventListener("pointermove", onMove, { passive: true });
	window.addEventListener("pointerdown", onDown, { passive: true });
	for (const watcher of watchers.values()) {
		blinkLater(watcher);
	}
}

function stop() {
	if (!listening) {
		return;
	}
	listening = false;
	window.removeEventListener("pointermove", onMove);
	window.removeEventListener("pointerdown", onDown);
	window.clearTimeout(idle);
	cancelAnimationFrame(frame);
	frame = 0;
	pointer = null;
	for (const watcher of watchers.values()) {
		window.clearTimeout(watcher.blink);
		delete watcher.el.dataset.blink;
		setGaze(watcher.el, 0, 0);
	}
}

function onVisibility() {
	if (document.visibilityState === "visible" && watchers.size > 0) {
		start();
	} else {
		stop();
	}
}

export function watchGaze(el: GazeElement) {
	if (watchers.size === 0) {
		document.addEventListener("visibilitychange", onVisibility);
	}
	const watcher: Watcher = { el, blink: 0 };
	watchers.set(el, watcher);
	setGaze(el, 0, 0);
	if (listening) {
		blinkLater(watcher);
		schedule();
	} else {
		start();
	}
	return () => {
		window.clearTimeout(watcher.blink);
		delete el.dataset.blink;
		watchers.delete(el);
		if (watchers.size === 0) {
			stop();
			document.removeEventListener("visibilitychange", onVisibility);
		}
	};
}
