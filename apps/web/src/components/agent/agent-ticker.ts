type Tick = (now: number) => void;

const FRAME_MS = 1000 / 30;
const ticks = new Set<Tick>();
let frame: number | null = null;
let last = 0;

function loop(now: number) {
	frame = null;
	if (ticks.size === 0) {
		return;
	}
	if (document.visibilityState === "visible" && now - last >= FRAME_MS) {
		last = now;
		for (const tick of ticks) {
			tick(now);
		}
	}
	frame = requestAnimationFrame(loop);
}

/** One shared frame loop at 30 fps for every agent outline on the page. */
export function onAgentTick(tick: Tick): () => void {
	ticks.add(tick);
	if (frame === null) {
		frame = requestAnimationFrame(loop);
	}
	return () => {
		ticks.delete(tick);
		if (ticks.size === 0 && frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
	};
}
