import { useEffect, useRef, useState } from "react";
import {
	DISSOLVE_CELL,
	DISSOLVE_MS,
	dissolveCells,
	dissolveDensity,
} from "#/components/agent/dither-dissolve";

const DISSOLVE_ALPHA = 0.6;

/**
 * Dithered noise inside a rounded footprint that swells and thins while
 * what it sits on lands, starting after the delay.
 */
export function AgentDissolve({
	delay,
	radius = 11,
}: {
	delay: number;
	radius?: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [done, setDone] = useState(false);

	useEffect(() => {
		const canvas = canvasRef.current;
		const parent = canvas?.parentElement;
		const context = canvas?.getContext("2d");
		if (!(canvas && parent && context)) {
			return;
		}
		const width = parent.offsetWidth;
		const height = parent.offsetHeight;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		const color =
			getComputedStyle(canvas).getPropertyValue("--agent").trim() || "blue";
		const start = performance.now() + delay;
		let frame = 0;
		const draw = (now: number) => {
			const elapsed = now - start;
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
			context.clearRect(0, 0, width, height);
			if (elapsed >= DISSOLVE_MS) {
				setDone(true);
				return;
			}
			context.save();
			context.beginPath();
			context.roundRect(0, 0, width, height, radius);
			context.clip();
			context.globalAlpha = DISSOLVE_ALPHA;
			context.fillStyle = color;
			for (const cell of dissolveCells(
				width,
				height,
				dissolveDensity(elapsed),
			)) {
				context.fillRect(
					cell.col * DISSOLVE_CELL,
					cell.row * DISSOLVE_CELL,
					DISSOLVE_CELL,
					DISSOLVE_CELL,
				);
			}
			context.restore();
			frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	}, [delay, radius]);

	if (done) {
		return null;
	}
	return (
		<canvas
			aria-hidden
			className="pointer-events-none absolute inset-0 size-full"
			data-agent-dissolve=""
			ref={canvasRef}
		/>
	);
}
