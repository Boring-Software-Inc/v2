import {
	BODY_H,
	BODY_X,
	BODY_Y,
	bubblePath,
	type Cheek,
	cheekClamp,
	cheekFor,
	densify,
	EXPRESSIONS,
	type Expression,
	eyeShapes,
	type Point,
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
	transition,
} from "#/components/mascot/machine";
import {
	DEFAULT_INTENSITY,
	type Pose,
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

export type MascotSettings = {
	intensity: number;
	speed: number;
	bob: number;
	follow: boolean;
	autoBlink: boolean;
	autoSleep: boolean;
	reduced: boolean;
	resting: Expression;
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
};

export type MascotSnapshot = {
	state: MascotState;
	expression: Expression;
	lastEvent: MascotEvent | null;
	lastAccepted: boolean;
	allowed: MascotEvent[];
	count: number;
};

export type MascotView = {
	body: SVGPathElement;
	zz: SVGGElement;
	bubble: SVGGElement;
	bubbleBody: SVGPathElement;
	prop: SVGRectElement;
	drip: SVGEllipseElement;
};

type Eye = { pts: Shape; cx: number; cy: number; cheek: Cheek | null };

const BODY_POINTS: Shape = densify(restOutline());

const EYES: Record<Expression, Eye[]> = Object.fromEntries(
	EXPRESSIONS.map((expr) => [
		expr,
		eyeShapes(expr).map((shape, i) => {
			const xs = shape.map((p) => p[0]);
			const ys = shape.map((p) => p[1]);
			return {
				pts: densify(shape, 0.8),
				cx: (Math.min(...xs) + Math.max(...xs)) / 2,
				cy: (Math.min(...ys) + Math.max(...ys)) / 2,
				cheek: cheekFor(expr, i === 0 ? -1 : 1),
			};
		}),
	]),
) as unknown as Record<Expression, Eye[]>;

const POSE_KEYS = Object.keys(REST_POSE) as (keyof Pose)[];
const SUBSTEP = 1 / 240;
const GAZE_X = 4.5;
const GAZE_Y = 3.2;
const AUTO_SLEEP_S = 14;
const DRIP_TOOTH_X = 63;

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
	const squash = Math.max(0.08, 1 - 0.92 * eyes.blink);
	for (const eye of EYES[expression]) {
		const ecx = eye.cx + eyes.gx;
		const ecy = eye.cy + eyes.gy;
		const cheek =
			eye.cheek && pose.cheek > 0.001
				? {
						...eye.cheek,
						ex: eye.cheek.ex + eyes.gx,
						ecy: eye.cheek.ecy + eyes.gy,
					}
				: null;
		appendShape(out, eye.pts, (x, y) => {
			const nx = ecx + (x - eye.cx) * eyes.pop;
			let ny = ecy + (y - eye.cy) * eyes.pop * squash;
			if (cheek) {
				ny = cheekClamp(ny, nx, cheek, pose.cheek);
			}
			return warpPoint(pose, nx, ny);
		});
	}
	return out.join("");
}

export const REST_PATH: Record<Expression, string> = Object.fromEntries(
	EXPRESSIONS.map((expr) => [expr, buildMascotPath(REST_POSE, expr)]),
) as Record<Expression, string>;

export class MascotEngine {
	private settings: MascotSettings = { ...DEFAULT_SETTINGS };
	private state: MascotState = "idle";
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
	private frame = 0;
	private last = 0;
	private visible = new WeakMap<Element, boolean>();
	private bubbleDots = new WeakMap<MascotView, number>();
	private snapshot: MascotSnapshot = {
		state: "idle",
		expression: "neutral",
		lastEvent: null,
		lastAccepted: true,
		allowed: allowedEvents("idle"),
		count: 0,
	};

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
		if (prev.resting !== next.resting) {
			this.kickPop();
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

	start() {
		if (this.frame) {
			return;
		}
		this.last = performance.now();
		const loop = (now: number) => {
			const dt = Math.min(0.05, (now - this.last) / 1000);
			this.last = now;
			this.tick(dt);
			this.frame = requestAnimationFrame(loop);
		};
		this.frame = requestAnimationFrame(loop);
	}

	stop() {
		cancelAnimationFrame(this.frame);
		this.frame = 0;
	}

	send(event: MascotEvent) {
		const next = transition(this.state, event);
		if (!next) {
			this.publish(event, false);
			return false;
		}
		const prevExpr = expressionFor(this.state, this.settings.resting);
		this.state = next;
		this.stateMs = 0;
		if (!RESTING_STATES.has(next) || event === "LOOK") {
			this.idleFor = 0;
		}
		if (next === "blink" || next === "idle" || next === "look") {
			this.blinkIn = 2.5 + Math.random() * 3.5;
		}
		if (expressionFor(next, this.settings.resting) !== prevExpr) {
			this.kickPop();
		}
		this.publish(event, true);
		return true;
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
			expression: expressionFor(this.state, this.settings.resting),
			lastEvent,
			lastAccepted,
			allowed: allowedEvents(this.state),
			count: this.snapshot.count + 1,
		};
		for (const listener of this.listeners) {
			listener();
		}
	}

	private tick(realDt: number) {
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
			if (s.autoBlink && this.state !== "blink") {
				this.blinkIn -= dt;
				if (this.blinkIn <= 0) {
					this.send("BLINK");
				}
			}
			if (this.state !== "look") {
				this.idleFor += dt;
			}
			if (s.autoSleep && this.idleFor >= AUTO_SLEEP_S) {
				this.idleFor = 0;
				this.send("SLEEP");
			}
		}

		const active = SCRIPTS[this.state];
		const current = stepAt(active, this.stateMs);
		const intensity = s.reduced ? 0 : s.intensity;
		const target = soften(V7_POSES[current.pose], intensity, !s.reduced);
		const spring = SPRINGS[current.spring];
		const gazing = s.follow && this.pointer && GAZE_STATES.has(this.state);
		const gx = gazing && this.pointer ? this.pointer.x * GAZE_X : 0;
		const gy = gazing && this.pointer ? this.pointer.y * GAZE_Y : 0;

		let left = dt;
		while (left > 0) {
			const h = Math.min(SUBSTEP, left);
			if (!s.reduced) {
				for (const k of POSE_KEYS) {
					stepSpring(this.pose[k], target[k], spring, h);
				}
				stepSpring(this.floatWeight, active.float, SPRINGS.soft, h);
				stepSpring(this.pop, 1, SPRINGS.bouncy, h);
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
		}
		this.render();
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
		if (this.state === "angry" && this.stateMs < 650) {
			const t = this.stateMs / 1000;
			p.lean +=
				4 * s.intensity * Math.sin(2 * Math.PI * 9 * t) * (1 - t / 0.65);
		}
		return p;
	}

	private blinkAmount(): number {
		const reduced = this.settings.reduced;
		if (this.state === "blink") {
			if (reduced) {
				return 1;
			}
			return Math.sin(Math.PI * Math.min(1, this.stateMs / 160));
		}
		if (this.state === "poked" && this.stateMs > 60 && this.stateMs < 220) {
			return reduced ? 1 : Math.sin((Math.PI * (this.stateMs - 60)) / 160);
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
		const expression = expressionFor(this.state, s.resting);
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
			this.setVisible(view.prop, expression === "angry");
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
