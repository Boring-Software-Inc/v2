import type { MascotEngine } from "#/components/mascot/engine";

export type RunnerHost = { engine: MascotEngine; art: HTMLElement };

export type RunnerSession = {
	host: RunnerHost;
	key: (event: KeyboardEvent) => void;
	exit: (now?: boolean) => void;
};

const TOUCH = "(pointer: coarse), (hover: none)";
const FIELDS =
	"input, textarea, select, [contenteditable]:not([contenteditable=false])";
const ACTIVATORS =
	"button, a[href], summary, [role=button], [role=link], [role=menuitem], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=option], [role=slider]";
const OVERLAYS =
	"dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]";

const hosts = new Set<RunnerHost>();
let session: RunnerSession | null = null;
let loading = false;
let listening = false;

function blocked(target: EventTarget | null): boolean {
	if (document.querySelector(OVERLAYS)) {
		return true;
	}
	if (!(target instanceof Element)) {
		return false;
	}
	if (target.closest(FIELDS)) {
		return true;
	}
	const activator = target.closest(ACTIVATORS);
	return activator !== null && ![...hosts].some((h) => h.art === activator);
}

function nearest(): RunnerHost | null {
	const cx = window.innerWidth / 2;
	const cy = window.innerHeight / 2;
	let best: RunnerHost | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const host of hosts) {
		const box = host.art.getBoundingClientRect();
		const visible =
			box.width > 0 &&
			box.bottom > 0 &&
			box.top < window.innerHeight &&
			box.right > 0 &&
			box.left < window.innerWidth;
		if (!visible) {
			continue;
		}
		const distance = Math.hypot(
			box.left + box.width / 2 - cx,
			box.top + box.height / 2 - cy,
		);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = host;
		}
	}
	return best;
}

function onKeyDown(event: KeyboardEvent) {
	if (session) {
		session.key(event);
		return;
	}
	if (event.code !== "Space" || event.repeat || event.defaultPrevented) {
		return;
	}
	if (loading || blocked(event.target)) {
		return;
	}
	const host = nearest();
	if (!host) {
		return;
	}
	event.preventDefault();
	loading = true;
	import("#/components/mascot/runner/game")
		.then(({ startRunner }) => {
			loading = false;
			if (!hosts.has(host)) {
				return;
			}
			session = startRunner(host, () => {
				session = null;
			});
		})
		.catch(() => {
			loading = false;
		});
}

function listen(on: boolean) {
	if (on === listening) {
		return;
	}
	listening = on;
	if (on) {
		window.addEventListener("keydown", onKeyDown);
	} else {
		window.removeEventListener("keydown", onKeyDown);
	}
}

export function registerRunnerHost(host: RunnerHost): () => void {
	if (window.matchMedia(TOUCH).matches) {
		return () => {};
	}
	hosts.add(host);
	listen(true);
	return () => {
		hosts.delete(host);
		if (session?.host === host) {
			session.exit(true);
		}
		if (hosts.size === 0) {
			listen(false);
		}
	};
}
