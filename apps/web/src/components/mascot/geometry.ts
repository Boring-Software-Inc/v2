export type Point = readonly [number, number];
export type Shape = readonly Point[];

export const EXPRESSIONS = [
	"neutral",
	"happy",
	"angry",
	"sleepy",
	"talking",
	"surprised",
] as const;

export type Expression = (typeof EXPRESSIONS)[number];

export const CELL = 6;
export const BODY_W = 16 * CELL;
export const BODY_H = 17 * CELL;
export const BODY_X = 12;
export const BODY_Y = 14;
export const VIEW_BOX = "6 11 108 108";
export const SAGE = "#A9C49A";

const OUTLINE_CELLS: Shape = [
	[5, 0],
	[11, 0],
	[11, 1],
	[13, 1],
	[13, 2],
	[14, 2],
	[14, 3],
	[15, 3],
	[15, 4],
	[16, 4],
	[16, 17],
	[13, 17],
	[13, 15],
	[12, 15],
	[12, 17],
	[9, 17],
	[9, 15],
	[7, 15],
	[7, 17],
	[4, 17],
	[4, 15],
	[3, 15],
	[3, 17],
	[0, 17],
	[0, 4],
	[1, 4],
	[1, 3],
	[2, 3],
	[2, 2],
	[3, 2],
	[3, 1],
	[5, 1],
];

export function restOutline(): Shape {
	return OUTLINE_CELLS.map(([x, y]) => [x * CELL, y * CELL] as const);
}

export function arcPoints(
	cx: number,
	cy: number,
	r: number,
	a0: number,
	a1: number,
	n = 14,
): Point[] {
	const out: Point[] = [];
	for (let i = 0; i <= n; i++) {
		const a = a0 + ((a1 - a0) * i) / n;
		out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
	}
	return out;
}

export function rotatePoints(
	pts: Shape,
	deg: number,
	cx: number,
	cy: number,
): Point[] {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as const);
}

export function roundedRect(
	cx: number,
	cy: number,
	w: number,
	h: number,
	radius: number,
	rot = 0,
	n = 8,
): Point[] {
	const r = Math.min(radius, w / 2, h / 2);
	const corners: [number, number, number][] = [
		[w / 2 - r, -h / 2 + r, -Math.PI / 2],
		[w / 2 - r, h / 2 - r, 0],
		[-w / 2 + r, h / 2 - r, Math.PI / 2],
		[-w / 2 + r, -h / 2 + r, Math.PI],
	];
	const pts: Point[] = [];
	for (const [qx, qy, a] of corners) {
		pts.push(...arcPoints(qx, qy, r, a, a + Math.PI / 2, n));
	}
	return rotatePoints(pts, rot, cx, cy);
}

export function densify(pts: Shape, step = 1.5): Point[] {
	const out: Point[] = [];
	const n = pts.length;
	for (let i = 0; i < n; i++) {
		const a = pts[i] as Point;
		const b = pts[(i + 1) % n] as Point;
		const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
		const k = Math.max(1, Math.floor(length / step));
		for (let j = 0; j < k; j++) {
			const t = j / k;
			out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
		}
	}
	return out;
}

export const FACE_CX = BODY_W / 2;
export const FACE_CY = BODY_H * 0.36;
export const FACE_SCALE = 1.18;

function relativeTo(pts: Shape, cx: number, cy: number): Point[] {
	return pts.map(([x, y]) => [x - cx, y - cy] as const);
}

export function eyeShapes(expr: Expression): Shape[] {
	const cx = FACE_CX;
	const cy = FACE_CY;
	const s = FACE_SCALE;
	const g = 13.5 * s;
	const tilt = expr === "neutral" || expr === "talking" ? -6 : -8;
	if (expr === "surprised") {
		const gs = 14 * s;
		return [
			roundedRect(cx - gs, cy, 17 * s, 24 * s, 8.5 * s, 0),
			roundedRect(cx + gs, cy, 17 * s, 24 * s, 8.5 * s, 0),
		];
	}
	if (expr === "neutral" || expr === "talking") {
		return [
			roundedRect(cx - g, cy, 15.5 * s, 28 * s, 7.75 * s, tilt),
			roundedRect(cx + g, cy, 15.5 * s, 28 * s, 7.75 * s, tilt),
		];
	}
	if (expr === "angry") {
		return [-1, 1].map((side) => {
			const ex = cx + side * g;
			const topOut: Point = [ex + side * 8 * s, cy - 8 * s];
			const topIn: Point = [ex - side * 8 * s, cy + 1 * s];
			const [left, right] = side === 1 ? [topIn, topOut] : [topOut, topIn];
			const pts = [
				left,
				right,
				...arcPoints(ex, cy + 3 * s, 8 * s, 0, Math.PI, 12),
			];
			return rotatePoints(relativeTo(pts, cx, cy), tilt * 0.4, cx, cy);
		});
	}
	if (expr === "happy") {
		return [-1, 1].map((side) => {
			const ex = cx + side * g;
			const pts = arcPoints(ex, cy + 5 * s, 9 * s, Math.PI, 2 * Math.PI, 16);
			return rotatePoints(relativeTo(pts, cx, cy), tilt * 0.4, cx, cy);
		});
	}
	return [-1, 1].map((side) =>
		roundedRect(cx + side * (g - 1), cy + 4 * s, 15 * s, 3.6 * s, 1.8 * s, -14),
	);
}

export type Cheek = {
	ex: number;
	ecy: number;
	ew: number;
	eh: number;
	amount: number;
};

export function cheekFor(expr: Expression, side: -1 | 1): Cheek | null {
	const s = FACE_SCALE;
	const g = 13.5 * s;
	if (expr === "happy") {
		return {
			ex: FACE_CX + side * g,
			ecy: FACE_CY + 5 * s,
			ew: 18 * s,
			eh: 10 * s,
			amount: 4.5 * s,
		};
	}
	if (expr === "neutral" || expr === "talking") {
		return {
			ex: FACE_CX + side * g,
			ecy: FACE_CY,
			ew: 15.5 * s,
			eh: 28 * s,
			amount: 9 * s,
		};
	}
	return null;
}

export function cheekClamp(y: number, x: number, cheek: Cheek, k: number) {
	const base = cheek.ecy + cheek.eh * 0.5;
	const t = (x - cheek.ex) / (cheek.ew * 0.75);
	const yc = base - cheek.amount * k * (1 - Math.min(1, t * t));
	return Math.min(y, yc);
}

export type Warp = {
	sx: number;
	sy: number;
	lean: number;
	bow: number;
	bowT: number;
	keystone: number;
	lift: number;
	rot: number;
	droop: number;
};

export function warpPoint(p: Warp, x: number, y: number): Point {
	const cx = BODY_W / 2;
	const v = y / BODY_H;
	const u = (x - cx) / (BODY_W / 2);
	const kx = 1 + p.keystone * (v - 0.5) * 2;
	let nx = cx + (x - cx) * p.sx * kx;
	let ny = BODY_H - (BODY_H - y) * p.sy;
	nx += p.bow * Math.sin(Math.PI * v) * u;
	ny -= p.bowT * (1 - v) ** 2 * (1 - u * u);
	nx += p.lean * (1 - v);
	ny += p.droop * (1 - v) * Math.max(0, u);
	ny -= p.lift;
	if (p.rot !== 0) {
		const a = (p.rot * Math.PI) / 180;
		const dx = nx - cx;
		const dy = ny - BODY_H;
		nx = cx + dx * Math.cos(a) - dy * Math.sin(a);
		ny = BODY_H + dx * Math.sin(a) + dy * Math.cos(a);
	}
	return [nx, ny];
}

export const REST_WARP: Warp = {
	sx: 1,
	sy: 1,
	lean: 0,
	bow: 0,
	bowT: 0,
	keystone: 0,
	lift: 0,
	rot: 0,
	droop: 0,
};

export function zzShapes(x: number, y: number, k: number): Shape[] {
	const z = (zx: number, zy: number, zk: number): Shape => [
		[zx, zy],
		[zx + 6 * zk, zy],
		[zx + 6 * zk, zy + 1.6 * zk],
		[zx + 1.9 * zk, zy + 5.4 * zk],
		[zx + 6 * zk, zy + 5.4 * zk],
		[zx + 6 * zk, zy + 7 * zk],
		[zx, zy + 7 * zk],
		[zx, zy + 5.4 * zk],
		[zx + 4.1 * zk, zy + 1.6 * zk],
		[zx, zy + 1.6 * zk],
	];
	return [z(x, y, k * 0.55), z(x + 5 * k, y - 6 * k, k)];
}

export function bubbleShapes(x: number, y: number, k = 1) {
	const body = roundedRect(x, y, 26 * k, 14 * k, 6 * k);
	const tail: Shape = [
		[x - 8 * k, y + 5 * k],
		[x - 3 * k, y + 5 * k],
		[x - 11 * k, y + 12 * k],
	];
	const dots = [-6.5, 0, 6.5].map((dx) =>
		roundedRect(x + dx * k, y, 3.4 * k, 3.4 * k, 1.7 * k),
	);
	return { body, tail, dots };
}

export function pathOf(pts: Shape, dx = 0, dy = 0): string {
	let d = "";
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i] as Point;
		d += `${i === 0 ? "M" : "L"}${(p[0] + dx).toFixed(2)} ${(p[1] + dy).toFixed(2)}`;
	}
	return `${d}Z`;
}

export const ZZ_PATH = zzShapes(100, -2, 1.7)
	.map((z) => pathOf(z))
	.join("");

const BUBBLE = bubbleShapes(106, 2, 1.05);

export function bubblePath(dots: number): string {
	return (
		pathOf(BUBBLE.body) +
		BUBBLE.dots
			.slice(0, dots)
			.map((q) => pathOf(q))
			.join("")
	);
}

export const BUBBLE_TAIL_PATH = pathOf(BUBBLE.tail);

export const PROP_RECT = {
	x: BODY_X + BODY_W + 6,
	y: BODY_Y + BODY_H - 12,
	size: 12,
};
