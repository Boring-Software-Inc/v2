import type { MascotDriver } from "#/components/mascot/engine";
import {
	BODY_H,
	BODY_X,
	BODY_Y,
	CELL,
	warpPointInto,
} from "#/components/mascot/geometry";
import {
	type Pose,
	type PoseName,
	REST_POSE,
	V7_POSES,
} from "#/components/mascot/poses";
import {
	BONE_CELL,
	BONE_RUNS,
	DIGIT_RUNS,
	EYE_BOTTOM,
	EYE_X,
	type Loop,
	type Run,
	SIDE_BODY,
	SIDE_EYE,
	SIDE_EYE_HURT,
} from "#/components/mascot/runner/art";
import {
	BONE_WIDTH,
	type Bone,
	bonePool,
	fixedSteps,
	groundedBody,
	hits,
	LANDED,
	nextGap,
	PLAYER_SIZE,
	resetBody,
	STEP,
	spawnBones,
	speedAt,
	stepBody,
} from "#/components/mascot/runner/physics";
import type {
	RunnerHost,
	RunnerSession,
} from "#/components/mascot/runner/trigger";
import { SPRINGS, type SpringName } from "#/components/mascot/scripts";
import { channel, stepSpring } from "#/components/mascot/spring";

const INTRO = 0.5;
const INTRO_REDUCED = 0.15;
const RESTART_DELAY = 0.35;
const SPECKS = 24;
const SPECK_BAND = 14;
const SCORE_RATE = 0.04;
const VIEW_LEFT = 6;
const VIEW_TOP = 11;
const VIEW_SIZE = 108;
const GROUND_X = BODY_X + 48;
const GROUND_Y = BODY_Y + BODY_H;
const BEST_KEY = "tripwire.ghost-runner.best";
const POSE_KEYS = Object.keys(REST_POSE) as (keyof Pose)[];
const INTRO_PHASE = 1;
const RUNNING = 2;
const OVER = 3;
const OUTRO = 4;

type Speck = { x: number; y: number; w: number };

function ease(t: number) {
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function readBest(): number {
	try {
		return Number(window.sessionStorage.getItem(BEST_KEY)) || 0;
	} catch {
		return 0;
	}
}

function writeBest(value: number) {
	try {
		window.sessionStorage.setItem(BEST_KEY, String(value));
	} catch {
		return;
	}
}

export function startRunner(
	host: RunnerHost,
	onEnd: () => void,
): RunnerSession | null {
	const card = host.art.closest<HTMLElement>('[data-slot="empty"]');
	if (!card) {
		return null;
	}
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const intensity = reduced ? 0.15 : 0.6;
	const introLength = reduced ? INTRO_REDUCED : INTRO;
	const style = getComputedStyle(card);
	const ink = style.getPropertyValue("--ink").trim() || "#050505";
	const shell = style.getPropertyValue("--shell").trim() || "#f1f1f0";
	const padLeft = Number.parseFloat(style.paddingLeft) || 0;
	const padRight = Number.parseFloat(style.paddingRight) || 0;
	const cardBox = card.getBoundingClientRect();
	const artBox = host.art.getBoundingClientRect();
	const unit = artBox.width / VIEW_SIZE;
	const stripWidth = cardBox.width - padLeft - padRight;
	const baseline = artBox.top - cardBox.top + (GROUND_Y - VIEW_TOP) * unit;
	const stripHeight = baseline + SPECK_BAND;
	const scale = Math.min(
		(artBox.height * 0.62) / PLAYER_SIZE,
		(baseline - 6) / (PLAYER_SIZE + 86),
	);
	const playerPx = PLAYER_SIZE * scale;
	const playerX = Math.max(8, stripWidth * 0.08) / scale;
	const ghostHome =
		artBox.left - cardBox.left - padLeft + (GROUND_X - VIEW_LEFT) * unit;
	const playerCentre = playerX * scale + playerPx / 2;
	const shrink = playerPx / (BODY_H * unit);

	const canvas = document.createElement("canvas");
	canvas.setAttribute("aria-hidden", "true");
	canvas.style.cssText = `position:absolute;left:${cardBox.left + padLeft - artBox.left}px;top:${cardBox.top - artBox.top}px;width:${stripWidth}px;height:${stripHeight}px;max-width:none;max-height:none;pointer-events:none`;
	const dpr = Math.min(3, window.devicePixelRatio || 1);
	canvas.width = Math.round(stripWidth * dpr);
	canvas.height = Math.round(stripHeight * dpr);
	const live = document.createElement("span");
	live.className = "sr-only";
	live.setAttribute("aria-live", "polite");
	const label = host.art.getAttribute("aria-label");
	host.art.append(canvas);
	host.art.setAttribute("aria-label", "Ghost game");
	card.append(live);
	const context = canvas.getContext("2d");
	if (!context) {
		canvas.remove();
		live.remove();
		return null;
	}
	const ctx = context;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	const body = groundedBody();
	const bones: Bone[] = bonePool(10);
	const specks: Speck[] = Array.from({ length: SPECKS }, () => ({
		x: Math.random() * stripWidth,
		y: 3 + Math.random() * (SPECK_BAND - 5),
		w: Math.random() < 0.3 ? 2.5 : 1.5,
	}));
	const pose = { ...REST_POSE };
	const channels = POSE_KEYS.map((k) => channel(REST_POSE[k]));
	const carry = [0];
	const point = [0, 0];
	let phase = INTRO_PHASE;
	let progress = 0;
	let time = 0;
	let score = 0;
	let best = readBest();
	let spawnIn = 0;
	let jumpQueued = false;
	let overFor = 0;
	let poseName: PoseName = "rest";
	let spring: SpringName = "soft";
	let poseHold = 0;
	let ended = false;
	let pathCache = "";
	let pathOver = false;
	const lastPose = { ...REST_POSE, sx: Number.NaN };

	function resetWorld() {
		resetBody(body);
		for (const bone of bones) {
			bone.active = false;
		}
		time = 0;
		score = 0;
		overFor = 0;
		jumpQueued = false;
		spawnIn = (stripWidth / scale) * 0.6;
		carry[0] = 0;
		live.textContent = "";
	}

	function setPose(name: PoseName, s: SpringName, hold: number) {
		poseName = name;
		spring = s;
		poseHold = hold;
	}

	function choosePose() {
		if (poseHold > 0) {
			poseHold -= STEP;
			if (poseHold <= 0 && poseName === "landing") {
				setPose("settle", "bouncy", 0.14);
			}
			return;
		}
		if (phase === OVER) {
			setPose("stiff", "snappy", 0);
		} else if (body.grounded) {
			if (body.windup > 0) {
				setPose("anticipation", "snappy", 0);
			} else {
				setPose("rest", "soft", 0);
			}
		} else if (body.velocity > 160) {
			setPose("stretch", "snappy", 0);
		} else if (body.velocity > -160) {
			setPose("apex", "soft", 0);
		} else {
			setPose("tall", "soft", 0);
		}
	}

	function stepPose() {
		const source = V7_POSES[poseName];
		const s = SPRINGS[spring];
		for (let i = 0; i < POSE_KEYS.length; i++) {
			const key = POSE_KEYS[i] as keyof Pose;
			const base = key === "sx" || key === "sy" ? 1 : 0;
			const value =
				key === "lift" ? 0 : base + (source[key] - base) * intensity;
			const c = channels[i];
			if (c) {
				stepSpring(c, value, s, STEP);
				pose[key] = c.value;
			}
		}
	}

	function gameOver() {
		phase = OVER;
		overFor = 0;
		const points = Math.floor(score);
		const isBest = points > best;
		if (isBest) {
			best = points;
			writeBest(points);
		}
		live.textContent = isBest
			? `Game over. New best score ${points}.`
			: `Game over. Score ${points}.`;
		setPose("poke", "snappy", 0.14);
	}

	function step() {
		if (phase === RUNNING) {
			time += STEP;
			const speed = speedAt(time);
			const event = stepBody(body, jumpQueued);
			if (body.windup > 0 || !body.grounded) {
				jumpQueued = false;
			}
			if (event === LANDED) {
				setPose("landing", "bouncy", 0.12);
			}
			const dx = speed * STEP;
			score += dx * SCORE_RATE;
			for (const bone of bones) {
				if (bone.active) {
					bone.x -= dx;
					if (bone.x + BONE_WIDTH < -4) {
						bone.active = false;
					}
				}
			}
			spawnIn -= dx;
			if (spawnIn <= 0) {
				spawnBones(bones, stripWidth / scale + 4, Math.random);
				spawnIn = nextGap(speed, Math.random);
			}
			for (const speck of specks) {
				speck.x -= dx * scale;
				if (speck.x < -4) {
					speck.x += stripWidth + 8 + Math.random() * 30;
				}
			}
			if (hits(bones, playerX, body.height)) {
				gameOver();
			}
		}
		choosePose();
		stepPose();
	}

	function frame(dt: number) {
		if (phase === INTRO_PHASE) {
			progress = Math.min(1, progress + dt / introLength);
			if (progress >= 1) {
				phase = RUNNING;
				resetWorld();
			}
		} else if (phase === OUTRO) {
			progress = Math.max(0, progress - dt / introLength);
			if (progress <= 0) {
				finish();
				return;
			}
		} else if (phase === OVER) {
			overFor += dt;
		}
		const steps = fixedSteps(carry[0] ?? 0, dt, carry);
		for (let i = 0; i < steps; i++) {
			step();
		}
		draw();
	}

	function lineExtent(out: number[]) {
		const e = ease(progress);
		out[0] = ghostHome * (1 - e);
		out[1] = ghostHome + (stripWidth - ghostHome) * e;
	}

	function drawRuns(
		runs: readonly Run[],
		x: number,
		y: number,
		cell: number,
		grow: number,
	) {
		for (const run of runs) {
			ctx.fillRect(
				x + run.start * cell - grow,
				y + run.row * cell - grow,
				run.length * cell + grow * 2,
				cell + grow * 2,
			);
		}
	}

	function drawBone(bone: Bone) {
		const art = BONE_RUNS[bone.height];
		if (!art) {
			return;
		}
		const cell = BONE_CELL * scale;
		const x = bone.x * scale;
		const y = baseline - art.rows * cell;
		ctx.globalAlpha = 1;
		ctx.fillStyle = shell;
		drawRuns(art.runs, x, y, cell, 1.5);
		ctx.globalAlpha = 0.45;
		ctx.fillStyle = ink;
		drawRuns(art.runs, x, y, cell, 0);
	}

	function drawScore() {
		const cell = 1.5;
		const digits = 5;
		const advance = 4 * cell;
		let value = Math.min(99_999, Math.floor(score));
		const x = stripWidth - advance * digits;
		for (let i = digits - 1; i >= 0; i--) {
			const digit = value % 10;
			value = Math.floor(value / 10);
			drawRuns(DIGIT_RUNS[digit] ?? [], x + i * advance, 4, cell, 0);
		}
	}

	const extent = [0, 0];

	function draw() {
		ctx.clearRect(0, 0, stripWidth, stripHeight);
		lineExtent(extent);
		ctx.globalAlpha = 0.45;
		ctx.fillStyle = ink;
		ctx.fillRect(
			extent[0] ?? 0,
			baseline,
			(extent[1] ?? 0) - (extent[0] ?? 0),
			1.5,
		);
		if (phase === INTRO_PHASE || phase === OUTRO) {
			return;
		}
		for (const speck of specks) {
			ctx.fillRect(speck.x, baseline + speck.y, speck.w, speck.w * 0.6);
		}
		for (const bone of bones) {
			if (bone.active) {
				drawBone(bone);
			}
		}
		ctx.globalAlpha = 0.6;
		ctx.fillStyle = ink;
		drawScore();
	}

	function sidePath(): string {
		let same = pathOver === (phase === OVER);
		for (const key of POSE_KEYS) {
			if (Math.abs(pose[key] - lastPose[key]) > 0.0005) {
				same = false;
			}
			lastPose[key] = pose[key];
		}
		if (same) {
			return pathCache;
		}
		pathOver = phase === OVER;
		let d = "";
		const appendLoop = (loop: Loop, eye: boolean) => {
			for (let i = 0; i < loop.length; i++) {
				const p = loop[i] as Loop[number];
				let y = p[1];
				if (eye && pose.cheek > 0.001) {
					const t = (p[0] - EYE_X) / (CELL * 1.5);
					y = Math.min(
						y,
						EYE_BOTTOM - CELL * 1.2 * pose.cheek * (1 - Math.min(1, t * t)),
					);
				}
				warpPointInto(pose, p[0], y, point);
				d += `${i === 0 ? "M" : "L"}${((point[0] ?? 0) + BODY_X).toFixed(1)} ${((point[1] ?? 0) + BODY_Y).toFixed(1)}`;
			}
			d += "Z";
		};
		for (const loop of SIDE_BODY) {
			appendLoop(loop, false);
		}
		for (const loop of phase === OVER ? SIDE_EYE_HURT : SIDE_EYE) {
			appendLoop(loop, true);
		}
		pathCache = d;
		return d;
	}

	const turnPose = { ...REST_POSE };

	const driver: MascotDriver = {
		frame,
		path(front) {
			if (phase === INTRO_PHASE || phase === OUTRO) {
				const wobble = Math.sin(Math.PI * progress) * (reduced ? 0.1 : 1);
				turnPose.sx = 1 + 0.22 * wobble * intensity;
				turnPose.sy = 1 - 0.18 * wobble * intensity;
				turnPose.bowT = 3 * wobble * intensity;
				if (progress < 0.5) {
					return front(turnPose);
				}
				for (const key of POSE_KEYS) {
					pose[key] = turnPose[key];
				}
				return sidePath();
			}
			return sidePath();
		},
		transform() {
			const e = ease(progress);
			const s = 1 + (shrink - 1) * e;
			const lift =
				phase === INTRO_PHASE || phase === OUTRO ? 0 : body.height * scale;
			const dxPx = (playerCentre - ghostHome) * e;
			const dx = dxPx / unit;
			const dy = -lift / unit;
			return `translate(${(GROUND_X + dx).toFixed(2)} ${(GROUND_Y + dy).toFixed(2)}) scale(${s.toFixed(4)}) translate(${-GROUND_X} ${-GROUND_Y})`;
		},
	};

	function finish() {
		if (ended) {
			return;
		}
		ended = true;
		host.engine.setDriver(null);
		canvas.remove();
		live.remove();
		if (label === null) {
			host.art.removeAttribute("aria-label");
		} else {
			host.art.setAttribute("aria-label", label);
		}
		window.removeEventListener("blur", onBlur);
		document.removeEventListener("focusin", onFocus);
		observer.disconnect();
		onEnd();
	}

	function exit(now = false) {
		if (now) {
			finish();
			return;
		}
		if (phase === OUTRO || ended) {
			return;
		}
		for (const bone of bones) {
			bone.active = false;
		}
		phase = OUTRO;
		if (reduced) {
			progress = 0;
			finish();
		}
	}

	function onBlur() {
		exit();
	}

	function onFocus(event: FocusEvent) {
		if (event.target instanceof Node && !card?.contains(event.target)) {
			exit();
		}
	}

	const observer = new IntersectionObserver(
		([entry]) => {
			if (entry && entry.intersectionRatio < 0.25) {
				exit();
			}
		},
		{ threshold: [0, 0.25] },
	);
	observer.observe(card);
	window.addEventListener("blur", onBlur);
	document.addEventListener("focusin", onFocus);
	host.engine.setDriver(driver);

	return {
		host,
		key(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				exit();
				return;
			}
			if (event.code !== "Space" && event.code !== "ArrowUp") {
				return;
			}
			event.preventDefault();
			if (event.repeat) {
				return;
			}
			if (phase === RUNNING) {
				jumpQueued = true;
			} else if (phase === OVER && overFor >= RESTART_DELAY) {
				phase = RUNNING;
				resetWorld();
			}
		},
		exit,
	};
}
