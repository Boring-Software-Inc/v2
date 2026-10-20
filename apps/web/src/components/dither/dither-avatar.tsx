import { useEffect, useRef } from "react";
import {
	BAYER4,
	clamp01,
	fnv1a,
	hueFill,
	prefersReducedMotion,
	type Rgb,
	rgba,
	xorshift32,
} from "#/components/dither/pixel";
import { cn } from "#/lib/glaze/utils";

const GRID = 8;
const CELL_PX = 4;

type AvatarModel = {
	on: boolean[];
	density: number[];
	fill: Rgb;
};

export function avatarModel(name: string, hueProp?: number): AvatarModel {
	const rand = xorshift32(fnv1a(name));
	const bits = Array.from({ length: 32 }, () => rand() < 0.5);
	const vertical = rand() < 0.5;
	const drawnHue = Math.floor(rand() * 180) * 2;
	const halfDensity = Array.from({ length: 32 }, () => 0.55 + rand() * 0.45);
	const on = new Array<boolean>(GRID * GRID);
	const density = new Array<number>(GRID * GRID);
	for (let r = 0; r < GRID; r++) {
		for (let c = 0; c < GRID; c++) {
			const i = vertical
				? Math.min(r, GRID - 1 - r) * GRID + c
				: r * (GRID / 2) + Math.min(c, GRID - 1 - c);
			on[r * GRID + c] = bits[i];
			density[r * GRID + c] = halfDensity[i];
		}
	}
	return { on, density, fill: hueFill(hueProp ?? drawnHue) };
}

function paintAvatar(
	canvas: HTMLCanvasElement,
	model: AvatarModel,
	animate: boolean,
	duration: number,
): (() => void) | undefined {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return undefined;
	}
	const px = GRID * CELL_PX;
	canvas.width = px;
	canvas.height = px;

	const draw = (progress: number) => {
		ctx.clearRect(0, 0, px, px);
		for (let r = 0; r < GRID; r++) {
			for (let c = 0; c < GRID; c++) {
				if (!model.on[r * GRID + c]) {
					continue;
				}
				const start = BAYER4[r % 4][c % 4] * 0.7;
				const cellAlpha = clamp01((progress - start) / 0.3);
				if (cellAlpha <= 0) {
					continue;
				}
				const density = model.density[r * GRID + c];
				const base = 0.35 + 0.65 * density;
				for (let py = 0; py < CELL_PX; py++) {
					for (let pxi = 0; pxi < CELL_PX; pxi++) {
						const gx = c * CELL_PX + pxi;
						const gy = r * CELL_PX + py;
						const lit = density > BAYER4[gy & 3][gx & 3];
						const alpha = (lit ? base : base * 0.35) * cellAlpha;
						ctx.fillStyle = rgba(model.fill, alpha);
						ctx.fillRect(gx, gy, 1, 1);
					}
				}
			}
		}
	};

	if (!animate || prefersReducedMotion()) {
		draw(1);
		return undefined;
	}

	let raf = 0;
	const startTime = performance.now();
	const tick = (now: number) => {
		const t = clamp01((now - startTime) / duration);
		draw(1 - (1 - t) ** 3);
		if (t < 1) {
			raf = requestAnimationFrame(tick);
		}
	};
	raf = requestAnimationFrame(tick);
	return () => cancelAnimationFrame(raf);
}

export interface DitherAvatarProps {
	name: string;
	hue?: number;
	animate?: boolean;
	animationDuration?: number;
	replayToken?: number;
	label?: string;
	className?: string;
}

export function DitherAvatar({
	name,
	hue,
	animate = false,
	animationDuration = 600,
	replayToken = 0,
	label,
	className,
}: DitherAvatarProps) {
	const canvas = (
		<AvatarCanvas
			animate={animate}
			duration={animationDuration}
			hue={hue}
			key={replayToken}
			name={name}
		/>
	);
	if (label) {
		return (
			<span
				aria-label={label}
				className={cn("relative block", className)}
				role="img"
			>
				{canvas}
			</span>
		);
	}
	return (
		<span aria-hidden className={cn("relative block", className)}>
			{canvas}
		</span>
	);
}

function AvatarCanvas({
	name,
	hue,
	animate,
	duration,
}: {
	name: string;
	hue?: number;
	animate: boolean;
	duration: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		return paintAvatar(canvas, avatarModel(name, hue), animate, duration);
	}, [name, hue, animate, duration]);
	return (
		<canvas
			className="absolute inset-0 size-full [image-rendering:pixelated]"
			ref={canvasRef}
		/>
	);
}
