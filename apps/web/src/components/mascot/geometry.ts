export type Point = readonly [number, number];
export type Shape = readonly Point[];

export const EXPRESSIONS = [
	"neutral",
	"happy",
	"angry",
	"sleepy",
	"talking",
	"surprised",
	"annoyed",
	"poked",
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

type EyeArt = {
	rows: readonly string[];
	x: number;
	y: number;
	mirror: boolean;
	cheek: number;
};

const NEUTRAL_EYE: EyeArt = {
	rows: [".###", "####", "####", "####", "####", "###."],
	x: 3,
	y: 4,
	mirror: false,
	cheek: 0.3,
};

export const PIXEL_EYES = {
	neutral: NEUTRAL_EYE,
	talking: NEUTRAL_EYE,
	angry: {
		rows: ["#...", "##..", "###.", "####", ".##."],
		x: 3,
		y: 5,
		mirror: true,
		cheek: 0,
	},
	happy: {
		rows: [".##.", "####"],
		x: 3,
		y: 6,
		mirror: true,
		cheek: 0.45,
	},
	sleepy: {
		rows: ["##..", "..##"],
		x: 3,
		y: 7,
		mirror: false,
		cheek: 0,
	},
	surprised: {
		rows: [".##.", "####", "####", "####", "####", "####", ".##."],
		x: 3,
		y: 3,
		mirror: false,
		cheek: 0,
	},
	poked: {
		rows: [".#.", "###", "###", "###", ".#."],
		x: 4,
		y: 5,
		mirror: false,
		cheek: 0,
	},
	annoyed: {
		rows: ["####", ".###"],
		x: 3,
		y: 6,
		mirror: true,
		cheek: 0,
	},
} satisfies Record<Expression, EyeArt>;

export function cellsOf(
	rows: readonly string[],
	mirror = false,
): [number, number][] {
	const width = Math.max(...rows.map((r) => r.length));
	const out: [number, number][] = [];
	rows.forEach((row, y) => {
		for (let x = 0; x < row.length; x++) {
			if (row[x] === "#") {
				out.push([mirror ? width - 1 - x : x, y]);
			}
		}
	});
	return out;
}

export function traceCells(
	cells: readonly (readonly [number, number])[],
	size: number,
	ox = 0,
	oy = 0,
): Point[][] {
	const filled = new Set(cells.map(([x, y]) => `${x},${y}`));
	const has = (x: number, y: number) => filled.has(`${x},${y}`);
	const next = new Map<string, [number, number][]>();
	const add = (a: [number, number], b: [number, number]) => {
		const key = `${a[0]},${a[1]}`;
		const list = next.get(key) ?? [];
		list.push(b);
		next.set(key, list);
	};
	for (const [x, y] of cells) {
		if (!has(x, y - 1)) add([x, y], [x + 1, y]);
		if (!has(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
		if (!has(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
		if (!has(x - 1, y)) add([x, y + 1], [x, y]);
	}
	const loops: Point[][] = [];
	for (const [startKey, list] of next) {
		while (list.length) {
			const loop: [number, number][] = [];
			let [cx, cy] = startKey.split(",").map(Number) as [number, number];
			let guard = 0;
			do {
				loop.push([cx, cy]);
				const outs = next.get(`${cx},${cy}`);
				const step = outs?.shift();
				if (!step) {
					break;
				}
				[cx, cy] = step;
			} while (`${cx},${cy}` !== startKey && ++guard < 10_000);
			const corners = loop.filter((p, i) => {
				const a = loop[(i + loop.length - 1) % loop.length] as [number, number];
				const b = loop[(i + 1) % loop.length] as [number, number];
				return (b[0] - p[0]) * (p[1] - a[1]) !== (b[1] - p[1]) * (p[0] - a[0]);
			});
			loops.push(
				corners.map(([x, y]) => [ox + x * size, oy + y * size] as const),
			);
		}
	}
	return loops;
}

export type EyeShape = {
	outline: Shape;
	cx: number;
	cy: number;
	w: number;
	h: number;
	cheek: number;
};

export function eyeShapes(expr: Expression): EyeShape[] {
	const art = PIXEL_EYES[expr];
	const width = Math.max(...art.rows.map((r) => r.length));
	return [
		{ x: art.x, mirror: false },
		{ x: 16 - art.x - width, mirror: art.mirror },
	].flatMap(({ x, mirror }) =>
		traceCells(cellsOf(art.rows, mirror), CELL, x * CELL, art.y * CELL).map(
			(outline) => {
				const xs = outline.map((p) => p[0]);
				const ys = outline.map((p) => p[1]);
				const w = Math.max(...xs) - Math.min(...xs);
				const h = Math.max(...ys) - Math.min(...ys);
				return {
					outline,
					cx: Math.min(...xs) + w / 2,
					cy: Math.min(...ys) + h / 2,
					w,
					h,
					cheek: art.cheek,
				};
			},
		),
	);
}

export const LENS = {
	open: {
		rows: [
			"....##....",
			".########.",
			"##########",
			"##########",
			".########.",
			"....##....",
		],
		x: 3,
		y: 4,
	},
	closed: { rows: ["...####...", ".########."], x: 3, y: 6 },
	pupil: { x: 7, y: 6, w: 2, h: 2, reachX: 2, reachY: 1 },
} as const;

function lensLoops(art: { rows: readonly string[]; x: number; y: number }) {
	return traceCells(cellsOf(art.rows), CELL, art.x * CELL, art.y * CELL);
}

export const LENS_OPEN: Shape[] = lensLoops(LENS.open);
export const LENS_CLOSED: Shape[] = lensLoops(LENS.closed);

export function pupilShape(dx: number, dy: number): Shape {
	const { x, y, w, h } = LENS.pupil;
	const left = (x + dx) * CELL;
	const top = (y + dy) * CELL;
	return [
		[left, top],
		[left + w * CELL, top],
		[left + w * CELL, top + h * CELL],
		[left, top + h * CELL],
	];
}

export function cheekClamp(y: number, x: number, eye: EyeShape, k: number) {
	const base = eye.cy + eye.h * 0.5;
	const t = (x - eye.cx) / (eye.w * 0.75);
	const yc = base - eye.h * eye.cheek * k * (1 - Math.min(1, t * t));
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

const CLOUD_FRAMES = [
	[
		"...##...##..",
		"..####.####.",
		".##########.",
		"############",
		".##########.",
	],
	[
		"..###...##..",
		".#####.####.",
		"############",
		"############",
		"..########..",
	],
	[
		"...##..###..",
		"..####.####.",
		".###########",
		"############",
		".#########..",
	],
	[
		"..##...###..",
		".####.#####.",
		"###########.",
		"############",
		"..#########.",
	],
] as const;

const SWIRL: readonly (readonly [number, number])[][] = [
	[
		[5, 2],
		[6, 2],
	],
	[
		[6, 2],
		[6, 3],
	],
	[
		[5, 3],
		[6, 3],
	],
	[
		[5, 2],
		[5, 3],
	],
];

export const CLOUD = { cell: 4, x: 36, y: -16, cx: 60, cy: -6 };

export const CLOUD_PATHS = CLOUD_FRAMES.map((frame, i) => {
	const swirl = new Set((SWIRL[i] ?? []).map(([x, y]) => `${x},${y}`));
	const cells = cellsOf(frame).filter(([x, y]) => !swirl.has(`${x},${y}`));
	return traceCells(cells, CLOUD.cell, CLOUD.x, CLOUD.y)
		.map((loop) => pathOf(loop))
		.join("");
});

export const BOLT_PATH = traceCells(
	cellsOf(["..##", ".##.", "####", ".##.", "##.."]),
	2.5,
	80,
	3,
)
	.map((loop) => pathOf(loop))
	.join("");
