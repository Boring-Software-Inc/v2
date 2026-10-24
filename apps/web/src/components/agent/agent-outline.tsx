import type { AgentAction } from "@tripwire/contracts";
import { useEffect, useRef, useState } from "react";
import { onAgentTick } from "#/components/agent/agent-ticker";
import {
	cellLit,
	DEFAULT_RING,
	type RingCell,
	type RingGeometry,
	ringCells,
	ringGeometry,
	ringIntensity,
} from "#/components/agent/dither-ring";
import type { AgentMotion } from "#/hooks/use-agent-motion";
import { cn } from "#/lib/glaze/utils";

const FADE_OUT_MS = 300;

function agentColor(el: HTMLElement): string {
	return getComputedStyle(el).getPropertyValue("--agent").trim() || "blue";
}

function sameRing(a: RingGeometry, b: RingGeometry): boolean {
	return a.cell === b.cell && a.band === b.band && a.pad === b.pad;
}

function readRing(el: HTMLElement): RingGeometry {
	const style = getComputedStyle(el);
	return ringGeometry(
		style.getPropertyValue("--agent-outline-width"),
		style.getPropertyValue("--agent-dither-scale"),
	);
}

export interface AgentOutlineProps {
	active: boolean;
	action: AgentAction;
	at: string;
	motion: AgentMotion;
	radius?: number;
	className?: string;
}

/**
 * A dithered blue band around whatever it sits in, drawn on a canvas from
 * the 4 by 4 Bayer grid. It drifts while an agent works on the thing and
 * sweeps once for each new read, write, edit or delete. Reduced motion
 * draws it once, still.
 */
export function AgentOutline({
	active,
	action,
	at,
	motion,
	radius = 11,
	className,
}: AgentOutlineProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [size, setSize] = useState<{ width: number; height: number } | null>(
		null,
	);
	const [ring, setRing] = useState<RingGeometry>(DEFAULT_RING);
	const [shown, setShown] = useState(active);
	const startedAt = useRef(0);

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
			const next = readRing(canvas);
			setRing((current) => (sameRing(current, next) ? current : next));
		});
		observer.observe(parent);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		startedAt.current = Date.parse(at) || Date.now();
	}, [at]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!(canvas && size && shown)) {
			return;
		}
		const context = canvas.getContext("2d");
		if (!context) {
			return;
		}
		const ratio = window.devicePixelRatio || 1;
		const width = size.width + ring.pad * 2;
		const height = size.height + ring.pad * 2;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		const cells: RingCell[] = ringCells(size.width, size.height, radius, ring);
		const still = motion === "reduced";
		const pixel = ring.cell * ratio;
		const draw = (clock: number) => {
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = agentColor(canvas);
			const elapsed = still
				? Number.POSITIVE_INFINITY
				: Date.now() - startedAt.current;
			for (const cell of cells) {
				if (
					cellLit(cell, ringIntensity(cell, { action, elapsed, clock, still }))
				) {
					context.fillRect(cell.col * pixel, cell.row * pixel, pixel, pixel);
				}
			}
		};
		draw(performance.now());
		if (still) {
			return;
		}
		return onAgentTick(draw);
	}, [size, shown, motion, radius, action, ring]);

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
				inset: -ring.pad,
				width: `calc(100% + ${ring.pad * 2}px)`,
				height: `calc(100% + ${ring.pad * 2}px)`,
			}}
		/>
	);
}
