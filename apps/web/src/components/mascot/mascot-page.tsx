import { useTheme } from "next-themes";
import {
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import { Dark, Icon, Light } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { Kbd } from "#/components/glaze/ui/kbd";
import {
	DEFAULT_SETTINGS,
	MascotEngine,
	type MascotSettings,
} from "#/components/mascot/engine";
import { MascotControls } from "#/components/mascot/mascot-controls";
import { MascotFigure } from "#/components/mascot/mascot-figure";
import { MascotMachineCard } from "#/components/mascot/mascot-machine-card";
import { useHasMounted } from "#/hooks/use-has-mounted";

const REACH = 260;
const PREVIEW_SIZES = [96, 32, 24] as const;
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(listener: () => void) {
	const query = window.matchMedia(REDUCED_QUERY);
	query.addEventListener("change", listener);
	return () => query.removeEventListener("change", listener);
}

function isTypingTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.dataset.mascotStage !== undefined) {
		return false;
	}
	return (
		target.isContentEditable ||
		target.closest(
			"button, input, textarea, select, a, [role=slider], [role=switch], [role=radio], [role=checkbox]",
		) !== null
	);
}

export function MascotPage() {
	const [engine] = useState(() => new MascotEngine());
	const [settings, setSettings] = useState<MascotSettings>(DEFAULT_SETTINGS);
	const [sage, setSage] = useState(false);
	const [debug, setDebug] = useState(true);
	const snapshot = useSyncExternalStore(
		engine.subscribe,
		engine.getSnapshot,
		engine.getSnapshot,
	);
	const systemReduced = useSyncExternalStore(
		subscribeReduced,
		() => window.matchMedia(REDUCED_QUERY).matches,
		() => false,
	);
	const { resolvedTheme, setTheme } = useTheme();
	const hasMounted = useHasMounted();
	const isDark = hasMounted && resolvedTheme === "dark";

	useEffect(() => {
		engine.start();
		return () => engine.stop();
	}, [engine]);

	useEffect(() => {
		engine.configure({
			...settings,
			reduced: settings.reduced || systemReduced,
		});
	}, [engine, settings, systemReduced]);

	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent) => {
			if (event.code !== "Space" || event.repeat) {
				return;
			}
			if (isTypingTarget(event.target)) {
				return;
			}
			event.preventDefault();
			engine.send("HOP");
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [engine]);

	const onStageMove = (event: PointerEvent<HTMLButtonElement>) => {
		const box = event.currentTarget.getBoundingClientRect();
		const dx = event.clientX - (box.left + box.width / 2);
		const dy = event.clientY - (box.top + box.height / 2);
		const length = Math.hypot(dx, dy);
		const scale = length > REACH ? 1 / length : 1 / REACH;
		engine.setPointer({ x: dx * scale, y: dy * scale });
	};

	const onStageKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.code === "Space") {
			event.preventDefault();
		}
	};

	return (
		<div className="min-h-dvh bg-page text-text-1">
			<main className="mx-auto flex w-full max-w-288 flex-col gap-6 px-4 py-8">
				<header className="flex flex-wrap items-center gap-3">
					<h1 className="type-title">Mascot</h1>
					<Badge variant="outline">Dev only</Badge>
					<p className="type-body-sm text-text-2">
						Click the ghost to poke it. Press <Kbd>Space</Kbd> to hop.
					</p>
					<Button
						aria-label={
							isDark ? "Switch to light theme" : "Switch to dark theme"
						}
						className="ms-auto"
						onClick={() => setTheme(isDark ? "light" : "dark")}
						size="icon"
						variant="ghost"
					>
						<Icon icon={isDark ? Light : Dark} />
					</Button>
				</header>

				<div className="flex flex-col gap-6 lg:flex-row lg:items-start">
					<div className="flex min-w-0 flex-1 flex-col gap-6">
						<Card>
							<CardContent>
								<button
									aria-label="Poke the mascot"
									className="flex min-h-96 w-full cursor-pointer items-center justify-center rounded-panel focus-visible:focus-ring"
									data-mascot-stage=""
									onClick={() => engine.send("POKE")}
									onKeyUp={onStageKeyUp}
									onPointerLeave={() => engine.setPointer(null)}
									onPointerMove={onStageMove}
									type="button"
								>
									<MascotFigure
										engine={engine}
										resting={settings.resting}
										sage={sage}
										size={240}
									/>
								</button>
								<div className="flex items-end justify-center gap-8 border-t border-line-faint pt-3">
									{PREVIEW_SIZES.map((size) => (
										<figure
											className="flex flex-col items-center gap-1"
											key={size}
										>
											<MascotFigure
												engine={engine}
												resting={settings.resting}
												sage={sage}
												size={size}
											/>
											<figcaption className="type-caption text-text-3 tabular-nums">
												{size} px
											</figcaption>
										</figure>
									))}
								</div>
							</CardContent>
						</Card>
						<MascotMachineCard debug={debug} snapshot={snapshot} />
					</div>

					<MascotControls
						debug={debug}
						onDebug={setDebug}
						onSage={setSage}
						onSend={(event) => engine.send(event)}
						onSettings={setSettings}
						sage={sage}
						settings={settings}
						systemReduced={systemReduced}
					/>
				</div>
			</main>
		</div>
	);
}
