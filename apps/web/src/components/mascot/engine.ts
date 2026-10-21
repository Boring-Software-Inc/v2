import {
	BODY_H,
	BODY_X,
	BODY_Y,
	bubblePath,
	CELL,
	CLOUD,
	CLOUD_PATHS,
	cheekClamp,
	densify,
	EXPRESSIONS,
	type Expression,
	type EyeShape,
	eyeShapes,
	LENS,
	LENS_CLOSED,
	LENS_OPEN,
	type Point,
	pupilShape,
	restOutline,
	type Shape,
	warpPoint,
} from "#/components/mascot/geometry";
import {
	allowedEvents,
	expressionFor,
	GAZE_STATES,
	type MascotEvent,
	type MascotState,
	RESTING_STATES,
	recentPokes,
	resolvePoke,
	transition,
} from "#/components/mascot/machine";
import {
	DEFAULT_INTENSITY,
	type Pose,
	type PoseName,
	REST_POSE,
	soften,
	V7_POSES,
} from "#/components/mascot/poses";
import {
	SCRIPTS,
	SPRINGS,
	type Spring,
	stepAt,
} from "#/components/mascot/scripts";
import { trackMascot } from "#/components/mascot/ticker";

export type Gaze = { x: number; y: number };

export type Ambient = {
	event: MascotEvent;
	every: readonly [number, number];
	release?: { event: MascotEvent; after: number };
};

export type MascotSettings = {
	intensity: number;
	speed: number;
	bob: number;
	follow: boolean;
	autoBlink: boolean;
	autoSleep: boolean;
	reduced: boolean;
	resting: Expression;
	restPose: PoseName;
	autoSleepAfter: number;
	ambient: readonly Ambient[];
	wander: boolean;
	gazeRest: Gaze;
};

export const DEFAULT_SETTINGS: MascotSettings = {
	intensity: DEFAULT_INTENSITY,
	speed: 1,
	bob: 3,
	follow: true,
	autoBlink: true,
	autoSleep: false,
	reduced: false,
	resting: "neutral",
	restPose: "rest",
	autoSleepAfter: 14,
	ambient: [],
	wander: false,
	gazeRest: { x: 0, y: 0 },
};

export type MascotSnapshot = {
	state: MascotState;
	expression: Expression;
	lastEvent: MascotEvent | null;
	lastAccepted: boolean;
	allowed: MascotEvent[];
	pokes: number;
	count: number;
};

export type MascotView = {
	body: SVGPathElement;
	zz: SVGGElement;
	bubble: SVGGElement;
	bubbleBody: SVGPathElement;
	prop: SVGRectElement;
	drip: SVGEllipseElement;
	cloud: SVGGElement;
	cloudBody: SVGPathElement;
	bolt: SVGPathElement;
};

type Eye = EyeShape & { pts: Shape };

const BODY_POINTS: Shape = densify(restOutline());

const EYES = new Map<Expression, Eye[]>(
	EXPRESSIONS.map((expr) => [
		expr,
		eyeShapes(expr).map((eye) => ({ ...eye, pts: densify(eye.outline, 1) })),
	]),
);

const LENS_OPEN_POINTS = LENS_OPEN.map((loop) => densify(loop, 1));
const LENS_CLOSED_POINTS = LENS_CLOSED.map((loop) => densify(loop, 1));

const POSE_KEYS = Object.keys(REST_POSE) as (keyof Pose)[];
const SUBSTEP = 1 / 240;
const GAZE_X = CELL * 1.2;
const GAZE_Y = CELL * 1.2;
const DRIP_TOOTH_X = 63;
const SWAP_S = 0.07;

type Channel = { value: number; velocity: number };

const channel = (value: number): Channel => ({ value, velocity: 0 });

function stepSpring(c: Channel, target: number, s: Spring, dt: number) {
	const force = -s.stiffness * (c.value - target) - s.damping * c.velocity;
	c.velocity += force * dt;
	c.value += c.velocity * dt;
}

function fmt(n: number) {
	return n.toFixed(2);
}

function appendShape(
	out: string[],
	pts: ArrayLike<Point>,
	map: (x: number, y: number) => Point,
) {
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i] as Point;
		const [x, y] = map(p[0], p[1]);
		out.push(i === 0 ? "M" : "L", fmt(x + BODY_X), " ", fmt(y + BODY_Y));
	}
	out.push("Z");
}

export function buildMascotPath(
	pose: Pose,
	expression: Expression,
	eyes: { gx: number; gy: number; blink: number; pop: number } = {
		gx: 0,
		gy: 0,
		blink: 0,
		pop: 1,
	},
): string {
	const out: string[] = [];
	const warp = (x: number, y: number) => warpPoint(pose, x, y);
	appendShape(out, BODY_POINTS, warp);
	if (expression === "neutral") {
		const pupil = LENS.pupil;
		const dx = Math.max(
			-pupil.reachX,
			Math.min(pupil.reachX, Math.round((eyes.gx / CELL) * 1.7)),
		);
		const dy = Math.max(
			-pupil.reachY,
			Math.min(pupil.reachY, Math.round(eyes.gy / CELL)),
		);
		const closed = eyes.blink > 0.5;
		for (const loop of closed ? LENS_CLOSED_POINTS : LENS_OPEN_POINTS) {
			appendShape(out, loop, warp);
		}
		if (!closed) {
			appendShape(out, densify(pupilShape(dx, dy), 1), warp);
		}
		return out.join("");
	}
	const gx = Math.round(eyes.gx / CELL) * CELL;
	const gy = Math.round(eyes.gy / CELL) * CELL;
	const squash = Math.max(0.08, 1 - 0.92 * eyes.blink);
	for (const eye of EYES.get(expression) ?? []) {
		const ecx = eye.cx + gx;
		const ecy = eye.cy + gy;
		const shifted = { ...eye, cx: ecx, cy: ecy };
		const cheek = eye.cheek > 0 && pose.cheek > 0.001;
		appendShape(out, eye.pts, (x, y) => {
			const nx = ecx + (x - eye.cx) * eyes.pop;
			let ny = ecy + (y - eye.cy) * eyes.pop * squash;
			if (cheek) {
				ny = cheekClamp(ny, nx, shifted, pose.cheek);
			}
			return warpPoint(pose, nx, ny);
		});
	}
	return out.join("");
}

export const REST_PATH: Record<Expression, string> = Object.fromEntries(
	EXPRESSIONS.map((expr) => [expr, buildMascotPath(REST_POSE, expr)]),
) as Record<Expression, string>;

export function restFrame(
	face: Expression,
	state: MascotState = "idle",
	restPose: PoseName = "rest",
): string {
	if (restPose === "rest") {
		return REST_PATH[expressionFor(state, face)];
	}
	return buildMascotPath(
		soften(V7_POSES[restPose], DEFAULT_INTENSITY),
		expressionFor(state, face),
	);
}

function between([min, max]: readonly [number, number]) {
	return min + Math.random() * (max - min);
}

export class MascotEngine {
	private settings: MascotSettings;
	private state: MascotState;
	private stateMs = 0;
	private clock = 0;
	private pose: Record<keyof Pose, Channel> = Object.fromEntries(
		POSE_KEYS.map((k) => [k, channel(REST_POSE[k])]),
	) as Record<keyof Pose, Channel>;
	private gazeX = channel(0);
	private gazeY = channel(0);
	private floatWeight = channel(1);
	private pop = channel(1);
	private pointer: { x: number; y: number } | null = null;
	private blinkIn = 3;
	private idleFor = 0;
	private views = new Set<MascotView>();
	private listeners = new Set<() => void>();
	private untrack: (() => void) | null = null;
	private ambientIn: number[] = [];
	private release: { event: MascotEvent; at: number } | null = null;
	private wanderIn = 1;
	private wanderTo: Gaze = { x: 0, y: 0 };
	private pokeTimes: number[] = [];
	private shown: Expression = "neutral";
	private swapAt: number | null = null;
	private shakeAt = -10;
	private cloudScale = channel(0);
	private boltUntil = 0;
	private boltNext = 1.5;
	private visible = new WeakMap<Element, boolean>();
	private bubbleDots = new WeakMap<MascotView, number>();
	private cloudFrame = new WeakMap<MascotView, number>();
	private snapshot: MascotSnapshot;

	constructor(
		settings: MascotSettings = DEFAULT_SETTINGS,
		initial: MascotState = "idle",
	) {
		this.settings = settings;
		this.state = initial;
		this.shown = expressionFor(initial, settings.resting);
		this.ambientIn = settings.ambient.map((a) => between(a.every));
		this.snapshot = {
			state: initial,
			expression: expressionFor(initial, settings.resting),
			lastEvent: null,
			lastAccepted: true,
			allowed: allowedEvents(initial),
			pokes: 0,
			count: 0,
		};
	}

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = () => this.snapshot;

	configure(next: MascotSettings) {
		const prev = this.settings;
		this.settings = next;
		if (prev.ambient !== next.ambient) {
			this.ambientIn = next.ambient.map((a) => between(a.every));
		}
		if (!next.follow && this.state === "look") {
			this.send("LOOK_AWAY");
		}
		if (next.follow && this.pointer && this.state === "idle") {
			this.send("LOOK");
		}
		this.publish(this.snapshot.lastEvent, this.snapshot.lastAccepted);
	}

	setPointer(p: { x: number; y: number } | null) {
		const had = this.pointer !== null;
		this.pointer = p;
		if (!this.settings.follow) {
			return;
		}
		if (p && !had && transition(this.state, "LOOK")) {
			this.send("LOOK");
		} else if (!p && had && this.state === "look") {
			this.send("LOOK_AWAY");
		}
	}

	attach(view: MascotView) {
		this.views.add(view);
		this.render();
		return () => {
			this.views.delete(view);
		};
	}

	start(el?: Element, far?: number) {
		this.stop();
		this.untrack = trackMascot(this, el, far);
	}

	stop() {
		this.untrack?.();
		this.untrack = null;
	}

	poke() {
		if (this.state === "furious") {
			this.shakeAt = this.clock;
			this.publish("POKE", false);
			return false;
		}
		const now = this.clock * 1000;
		this.pokeTimes = [...recentPokes(this.pokeTimes, now), now];
		const event = resolvePoke(this.state, this.pokeTimes.length);
		if (!event) {
			this.publish("POKE", false);
			return false;
		}
		return this.send(event);
	}

	send(event: MascotEvent) {
		const next = transition(this.state, event);
		if (!next) {
			this.publish(event, false);
			return false;
		}
		this.state = next;
		this.stateMs = 0;
		if (next === "furious") {
			this.pokeTimes = [];
		}
		if (next === "furious" || next === "angry") {
			this.shakeAt = this.clock;
		}
		if (!RESTING_STATES.has(next) || event === "LOOK") {
			this.idleFor = 0;
		}
		if (next === "blink" || next === "idle" || next === "look") {
			this.blinkIn = 2.5 + Math.random() * 3.5;
		}
		this.publish(event, true);
		return true;
	}

	private expression(): Expression {
		return expressionFor(
			this.state,
			this.settings.resting,
			this.pokeTimes.length,
		);
	}

	private stormy(): boolean {
		return this.expression() === "angry" && this.state !== "annoyed";
	}

	private kickPop() {
		if (!this.settings.reduced) {
			this.pop.value = 0.78;
			this.pop.velocity = 0;
		}
	}

	private publish(lastEvent: MascotEvent | null, lastAccepted: boolean) {
		this.snapshot = {
			state: this.state,
			expression: this.expression(),
			lastEvent,
			lastAccepted,
			allowed: allowedEvents(this.state),
			pokes: this.pokeTimes.length,
			count: this.snapshot.count + 1,
		};
		for (const listener of this.listeners) {
			listener();
		}
	}

	tick(realDt: number) {
		const s = this.settings;
		const dt = realDt * s.speed;
		this.clock += dt;
		this.stateMs += dt * 1000;
		const script = SCRIPTS[this.state];

		if (script.timeoutMs !== undefined && this.stateMs >= script.timeoutMs) {
			this.send("TIMEOUT");
			if (this.state === "idle" && this.pointer && s.follow) {
				this.send("LOOK");
			}
		}

		if (RESTING_STATES.has(this.state)) {
			if (s.autoBlink && !s.reduced && this.state !== "blink") {
				this.blinkIn -= dt;
				if (this.blinkIn <= 0) {
					this.send("BLINK");
				}
			}
			this.idleFor += dt;
			if (s.autoSleep && this.idleFor >= s.autoSleepAfter) {
				this.idleFor = 0;
				this.send("SLEEP");
			}
		}
		this.ambience(dt);
		if (this.pokeTimes.length) {
			const kept = recentPokes(this.pokeTimes, this.clock * 1000);
			if (kept.length !== this.pokeTimes.length) {
				this.pokeTimes = kept;
				this.publish(this.snapshot.lastEvent, this.snapshot.lastAccepted);
			}
		}

		const active = SCRIPTS[this.state];
		const current = stepAt(active, this.stateMs);
		const intensity = s.reduced ? 0 : s.intensity;
		const poseName = current.pose === "rest" ? s.restPose : current.pose;
		const target = soften(V7_POSES[poseName], intensity, !s.reduced);
		const spring = SPRINGS[current.spring];
		const [gx, gy] = this.gazeTarget(dt);

		let left = dt;
		while (left > 0) {
			const h = Math.min(SUBSTEP, left);
			if (!s.reduced) {
				for (const k of POSE_KEYS) {
					stepSpring(this.pose[k], target[k], spring, h);
				}
				stepSpring(this.floatWeight, active.float, SPRINGS.soft, h);
				stepSpring(this.pop, 1, SPRINGS.bouncy, h);
				stepSpring(this.cloudScale, this.stormy() ? 1 : 0, SPRINGS.bouncy, h);
			}
			stepSpring(this.gazeX, gx, SPRINGS.soft, h);
			stepSpring(this.gazeY, gy, SPRINGS.soft, h);
			left -= h;
		}
		if (s.reduced) {
			for (const k of POSE_KEYS) {
				this.pose[k].value = target[k];
				this.pose[k].velocity = 0;
			}
			this.floatWeight.value = 0;
			this.pop.value = 1;
			this.cloudScale.value = this.stormy() ? 1 : 0;
		}
		this.render();
	}

	private gazeTarget(dt: number): [number, number] {
		const s = this.settings;
		if (!GAZE_STATES.has(this.state)) {
			return [0, 0];
		}
		if (s.follow && this.pointer) {
			return [this.pointer.x * GAZE_X, this.pointer.y * GAZE_Y];
		}
		if (s.wander && !s.reduced) {
			this.wanderIn -= dt;
			if (this.wanderIn <= 0) {
				this.wanderIn = between([1.4, 3.6]);
				const a = Math.random() * Math.PI * 2;
				const r = Math.random() < 0.3 ? 0 : 0.6 + Math.random() * 0.4;
				this.wanderTo = { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7 };
			}
			return [this.wanderTo.x * GAZE_X, this.wanderTo.y * GAZE_Y];
		}
		return [s.gazeRest.x * GAZE_X, s.gazeRest.y * GAZE_Y];
	}

	private ambience(dt: number) {
		const s = this.settings;
		if (s.reduced) {
			return;
		}
		if (this.release && this.clock >= this.release.at) {
			const { event } = this.release;
			this.release = null;
			this.send(event);
		}
		if (!RESTING_STATES.has(this.state)) {
			return;
		}
		s.ambient.forEach((a, i) => {
			const left = (this.ambientIn[i] ?? between(a.every)) - dt;
			this.ambientIn[i] = left;
			if (left > 0) {
				return;
			}
			this.ambientIn[i] = between(a.every);
			if (this.send(a.event) && a.release) {
				this.release = {
					event: a.release.event,
					at: this.clock + a.release.after,
				};
			}
		});
	}

	private currentPose(): Pose {
		const s = this.settings;
		const p = {} as Pose;
		for (const k of POSE_KEYS) {
			p[k] = this.pose[k].value;
		}
		if (s.reduced) {
			return p;
		}
		const period = SCRIPTS[this.state].bobPeriod ?? 2.6;
		const phase = (this.clock * 2 * Math.PI) / period;
		const w = Math.max(0, this.floatWeight.value);
		p.lift += s.bob * w * (0.5 - 0.5 * Math.cos(phase));
		const breath = 0.025 * s.intensity * w * (s.bob / 3) * Math.sin(phase);
		p.sy += breath;
		p.sx -= breath * 0.5;
		p.lean += this.gazeX.value * 0.3 * (s.intensity / DEFAULT_INTENSITY);
		const since = this.clock - this.shakeAt;
		const huff = this.state === "furious" ? 0.75 : 0.65;
		if (since >= 0 && since < huff) {
			p.lean +=
				4 *
				s.intensity *
				Math.sin(2 * Math.PI * 9 * since) *
				(1 - since / huff);
		}
		return p;
	}

	private settleFace() {
		const target = this.expression();
		if (this.swapAt !== null) {
			const t = this.clock - this.swapAt;
			if (t >= SWAP_S && this.shown !== target) {
				this.shown = target;
			}
			if (t >= SWAP_S * 2) {
				this.swapAt = null;
			}
			return;
		}
		if (target === this.shown) {
			return;
		}
		const lensSwap = (target === "neutral") !== (this.shown === "neutral");
		if (lensSwap && !this.settings.reduced) {
			this.swapAt = this.clock;
			return;
		}
		this.shown = target;
		this.kickPop();
	}

	private blinkAmount(): number {
		const reduced = this.settings.reduced;
		if (this.swapAt !== null) {
			const t = (this.clock - this.swapAt) / SWAP_S;
			return t < 1 ? t : Math.max(0, 2 - t);
		}
		if (this.state === "blink") {
			if (reduced) {
				return 1;
			}
			return Math.sin(Math.PI * Math.min(1, this.stateMs / 160));
		}
		if (this.state === "poked" && this.stateMs > 60 && this.stateMs < 220) {
			return reduced ? 0 : Math.sin((Math.PI * (this.stateMs - 60)) / 160);
		}
		return 0;
	}

	private setVisible(el: Element, on: boolean) {
		if (this.visible.get(el) === on) {
			return;
		}
		this.visible.set(el, on);
		el.setAttribute("visibility", on ? "visible" : "hidden");
	}

	private render() {
		if (this.views.size === 0) {
			return;
		}
		const s = this.settings;
		const pose = this.currentPose();
		this.settleFace();
		const expression = this.shown;
		const d = buildMascotPath(pose, expression, {
			gx: this.gazeX.value,
			gy: this.gazeY.value,
			blink: this.blinkAmount(),
			pop: this.pop.value,
		});
		const follow = `translate(0 ${fmt(-pose.lift * 0.6)})`;
		const zzPhase = (this.clock % 2.4) / 2.4;
		const zzTransform = s.reduced
			? follow
			: `translate(${fmt(zzPhase * 3)} ${fmt(-pose.lift * 0.6 - zzPhase * 9)})`;
		const zzOpacity = s.reduced ? "1" : fmt(Math.sin(Math.PI * zzPhase) ** 0.6);
		const dots = s.reduced ? 3 : Math.floor(this.clock / 0.32) % 4;
		const drip = this.drip(pose);
		const cloudK = Math.max(0, this.cloudScale.value);
		const cloudOn = cloudK > 0.02;
		const frameIndex = s.reduced
			? 0
			: Math.floor(this.clock / 0.16) % CLOUD_PATHS.length;
		const cloudD = CLOUD_PATHS[frameIndex] as string;
		const wobble = s.reduced ? 0 : Math.round(Math.sin(this.clock * 7)) * 1.5;
		const cloudTransform = `translate(${fmt(CLOUD.cx + pose.lean * 0.7 + wobble)} ${fmt(CLOUD.cy - pose.lift)}) scale(${fmt(cloudK)}) translate(${-CLOUD.cx} ${-CLOUD.cy})`;
		if (!s.reduced && cloudOn && this.clock >= this.boltNext) {
			this.boltUntil = this.clock + 0.13;
			this.boltNext = this.clock + 1.2 + Math.random() * 1.6;
		}
		const boltOn = cloudOn && !s.reduced && this.clock < this.boltUntil;

		for (const view of this.views) {
			view.body.setAttribute("d", d);
			this.setVisible(view.zz, expression === "sleepy");
			if (expression === "sleepy") {
				view.zz.setAttribute("transform", zzTransform);
				view.zz.setAttribute("opacity", zzOpacity);
			}
			this.setVisible(view.bubble, expression === "talking");
			if (expression === "talking") {
				view.bubble.setAttribute("transform", follow);
				if (this.bubbleDots.get(view) !== dots) {
					this.bubbleDots.set(view, dots);
					view.bubbleBody.setAttribute("d", bubblePath(dots));
				}
			}
			this.setVisible(view.cloud, cloudOn);
			if (cloudOn) {
				view.cloud.setAttribute("transform", cloudTransform);
				if (this.cloudFrame.get(view) !== frameIndex) {
					this.cloudFrame.set(view, frameIndex);
					view.cloudBody.setAttribute("d", cloudD);
				}
			}
			this.setVisible(view.bolt, boltOn);
			this.setVisible(view.drip, drip !== null);
			if (drip) {
				view.drip.setAttribute("cx", fmt(drip.cx));
				view.drip.setAttribute("cy", fmt(drip.cy));
				view.drip.setAttribute("rx", fmt(drip.rx));
				view.drip.setAttribute("ry", fmt(drip.ry));
			}
		}
	}

	private drip(pose: Pose) {
		if (this.state !== "sploot") {
			return null;
		}
		const t = this.stateMs;
		const floor = BODY_Y + BODY_H + 7;
		const [hx, hy] = warpPoint(pose, DRIP_TOOTH_X, BODY_H);
		const x = hx + BODY_X;
		const hem = hy + BODY_Y;
		if (this.settings.reduced) {
			return t > 300 && t < 2000 ? { cx: x, cy: floor, rx: 15, ry: 2.2 } : null;
		}
		if (t < 300) {
			return null;
		}
		if (t < 700) {
			const k = (t - 300) / 400;
			const r = 4.6 * k;
			return { cx: x, cy: hem + r * 0.9, rx: r * 0.85, ry: r * 1.15 };
		}
		if (t < 960) {
			const k = (t - 700) / 260;
			const y = hem + 4 + (floor - hem - 4) * k * k;
			return { cx: x, cy: y, rx: 3.8, ry: 5 };
		}
		if (t < 1500) {
			const k = Math.min(1, (t - 960) / 260);
			const e = 1 - (1 - k) ** 3;
			return { cx: x, cy: floor, rx: 4 + 11 * e, ry: 4.4 - 2.2 * e };
		}
		if (t < 2100) {
			const k = (t - 1500) / 600;
			return { cx: x, cy: floor, rx: 15 * (1 - k * k), ry: 2.2 * (1 - k) };
		}
		return null;
	}
}
