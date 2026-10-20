import { useEffect, useRef, useState } from "react";
import {
	type EmptyArtSize,
	emptyArtClass,
} from "#/components/glaze/ui/empty-state";
import {
	DEFAULT_SETTINGS,
	MascotEngine,
	type MascotSettings,
	restFrame,
} from "#/components/mascot/engine";
import { MascotFigure } from "#/components/mascot/mascot-figure";
import {
	MASCOT_MOODS,
	type MascotMood,
	type MascotMoodKey,
} from "#/components/mascot/moods";
import { useReducedMotion } from "#/components/mascot/use-reduced-motion";
import { cn } from "#/lib/glaze/utils";

export type MascotArtProps = {
	mood: MascotMoodKey;
	size?: EmptyArtSize;
	className?: string;
};

const PIXELS: Record<EmptyArtSize, number> = { default: 80, compact: 64 };

function settingsFor(mood: MascotMood, reduced: boolean): MascotSettings {
	return {
		...DEFAULT_SETTINGS,
		bob: 2,
		reduced,
		resting: mood.sleeps ? "neutral" : mood.face,
		autoSleep: mood.sleeps === true,
		autoSleepAfter: 5,
		restPose: mood.restPose ?? "rest",
		wander: mood.wander === true,
		gazeRest: mood.gazeRest ?? { x: 0, y: 0 },
		ambient: mood.ambient ?? [],
	};
}

export function MascotArt({
	mood,
	size = "default",
	className,
}: MascotArtProps) {
	const config: MascotMood = MASCOT_MOODS[mood];
	const reduced = useReducedMotion();
	const button = useRef<HTMLButtonElement>(null);
	const initial = config.sleeps ? "sleepy" : "idle";
	const [engine] = useState(
		() => new MascotEngine(settingsFor(config, reduced), initial),
	);

	useEffect(() => {
		engine.configure(settingsFor(config, reduced));
	}, [engine, config, reduced]);

	useEffect(() => {
		if (!button.current) {
			return;
		}
		engine.start(button.current, config.far);
		return () => engine.stop();
	}, [engine, config.far]);

	return (
		<button
			aria-label="Poke the ghost"
			className={cn(
				emptyArtClass(size),
				"cursor-pointer rounded-panel focus-visible:focus-ring",
				className,
			)}
			data-size={size}
			data-slot="empty-art"
			onClick={() => engine.poke()}
			ref={button}
			type="button"
		>
			<MascotFigure
				engine={engine}
				path={restFrame(
					config.sleeps ? "neutral" : config.face,
					initial,
					config.restPose,
				)}
				tone="muted"
				size={PIXELS[size]}
			/>
		</button>
	);
}
