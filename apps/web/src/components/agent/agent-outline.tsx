import { useEffect, useRef, useState } from "react";
import { onAgentTick } from "#/components/agent/agent-ticker";
import {
	DEFAULT_RING,
	DEFAULT_SHIMMER,
	type RingCell,
	type RingGeometry,
	ringCells,
	ringGeometry,
	ringPhase,
	ringTiming,
	type ShimmerTiming,
	segmentLit,
	trackAlpha,
} from "#/components/agent/dither-ring";
import type { AgentMotion } from "#/hooks/use-agent-motion";
import { cn } from "#/lib/glaze/utils";

const FADE_OUT_MS = 300;

interface RingLook {
	ring: RingGeometry;
	timing: ShimmerTiming;
}

const DEFAULT_LOOK: RingLook = { ring: DEFAULT_RING, timing: DEFAULT_SHIMMER };

function agentColor(el: HTMLElement): string {
	return getComputedStyle(el).getPropertyValue("--agent").trim() || "blue";
}

function readLook(el: HTMLElement): RingLook {
	const style = getComputedStyle(el);
	const token = (name: string) => style.getPropertyValue(name);
	return {
		ring: ringGeometry({
			gap: token("--agent-outline-gap"),
			track: token("--agent-outline-width"),
			segment: token("--agent-segment-width"),
			scale: token("--agent-dither-scale"),
		}),
		timing: ringTiming({
			lap: token("--agent-lap"),
			breathe: token("--agent-breathe"),
			length: token("--agent-segment-length"),
		}),
	};
}

function sameLook(a: RingLook, b: RingLook): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export interface AgentOutlineProps {
	active: boolean;
	motion: AgentMotion;
	seed: string;
	radius?: number;
	className?: string;
}

/**
 * A thin blue track around whatever it sits in, with a dithered segment
 * that travels round it while the track breathes. Reduced motion draws the
 * track alone, still.
 */
export function AgentOutline({
	active,
	motion,
	seed,
	radius = 11,
	className,
}: AgentOutlineProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [size, setSize] = useState<{ width: number; height: number } | null>(
		null,
	);
	const [look, setLook] = useState<RingLook>(DEFAULT_LOOK);
	const [shown, setShown] = useState(active);

	useEffect(() => {
		if (active) {
			setShown(true);
			return;
		}
		const timer = setTimeout(() => setShown(false), FADE_OUT_MS);
		return () => clearTimeout(timer);
	}, [active]);

	useEffect(() => {
		const canvas = canvasRef.current;
		const parent = canvas?.parentElement;
		if (!(canvas && parent)) {
			return;
		}
		const observer = new ResizeObserver(([entry]) => {
			const box = entry?.borderBoxSize[0];
			if (box) {
				setSize({ width: box.inlineSize, height: box.blockSize });
			}
			const next = readLook(canvas);
			setLook((current) => (sameLook(current, next) ? current : next));
		});
		observer.observe(parent);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!(canvas && size && shown)) {
			return;
		}
		const context = canvas.getContext("2d");
		if (!context) {
			return;
		}
		const { ring, timing } = look;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round((size.width + ring.pad * 2) * ratio);
		canvas.height = Math.round((size.height + ring.pad * 2) * ratio);
		const cells: RingCell[] = ringCells(size.width, size.height, radius, ring);
		const still = motion === "reduced";
		const phase = ringPhase(seed);
		const inset = ring.pad - ring.gap - ring.track / 2;
		const draw = (clock: number) => {
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
			context.clearRect(0, 0, canvas.width, canvas.height);
			const color = agentColor(canvas);
			context.strokeStyle = color;
			context.fillStyle = color;
			context.lineWidth = ring.track;
			context.globalAlpha = trackAlpha(clock, still, timing);
			context.beginPath();
			context.roundRect(
				inset,
				inset,
				size.width + (ring.pad - inset) * 2,
				size.height + (ring.pad - inset) * 2,
				radius + ring.gap + ring.track / 2,
			);
			context.stroke();
			if (still) {
				return;
			}
			context.globalAlpha = 1;
			for (const cell of cells) {
				if (segmentLit(cell, clock, phase, timing)) {
					context.fillRect(
						cell.col * ring.cell,
						cell.row * ring.cell,
						ring.cell,
						ring.cell,
					);
				}
			}
		};
		draw(performance.now());
		if (still) {
			return;
		}
		return onAgentTick(draw);
	}, [size, shown, motion, radius, look, seed]);

	return (
		<canvas
			aria-hidden
			className={cn(
				"pointer-events-none absolute max-w-none transition-opacity",
				active ? "opacity-100 duration-100" : "opacity-0 duration-300",
				className,
			)}
			data-agent-outline={active ? "on" : "off"}
			ref={canvasRef}
			style={{
				inset: -look.ring.pad,
				width: `calc(100% + ${look.ring.pad * 2}px)`,
				height: `calc(100% + ${look.ring.pad * 2}px)`,
			}}
		/>
	);
}
