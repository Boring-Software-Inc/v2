import type { CSSProperties } from "react";
import {
	DialogBody,
	DialogContent,
	type DialogContentProps,
} from "#/components/glaze/ui/dialog";
import { cn, mergeClass } from "#/lib/glaze/utils";

const SPRING = { stiffness: 360, damping: 34, mass: 1 };
const SAMPLES = 48;
const SETTLE = 0.001;

function springMotion() {
	const { stiffness, damping, mass } = SPRING;
	const w0 = Math.sqrt(stiffness / mass);
	const zeta = damping / (2 * Math.sqrt(stiffness * mass));
	const wd = w0 * Math.sqrt(1 - zeta * zeta);
	const at = (t: number) =>
		1 -
		Math.exp(-zeta * w0 * t) *
			(Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
	let settle = 0;
	for (let t = 0; t < 2; t += 0.001) {
		if (Math.abs(1 - at(t)) > SETTLE) {
			settle = t;
		}
	}
	const points = Array.from({ length: SAMPLES + 1 }, (_, i) =>
		at((settle * i) / SAMPLES).toFixed(4),
	);
	points[SAMPLES] = "1";
	return {
		"--sheet-spring": `linear(${points.join(", ")})`,
		"--sheet-rise": `${Math.round(settle * 1000)}ms`,
	} as CSSProperties;
}

export const SPRING_STYLE = springMotion();

export function InsetSheetContent({
	className,
	style,
	...props
}: Omit<DialogContentProps, "size">) {
	return (
		<DialogContent
			data-side="sheet"
			className={mergeClass(
				"top-auto -bottom-(--radius-shell) h-auto min-h-[min(44rem,calc(100dvh-var(--space-10)+var(--radius-shell)))] max-h-[calc(100dvh-var(--space-10)+var(--radius-shell))] w-[calc(100%-var(--space-2)*2)] max-w-none translate-y-0 rounded-b-none sm:w-[85vw] sm:max-w-3xl",
				className,
			)}
			size="lg"
			style={{ ...SPRING_STYLE, ...(style as CSSProperties) }}
			{...props}
		/>
	);
}

export function InsetSheetBody({
	className,
	...props
}: React.ComponentProps<typeof DialogBody>) {
	return (
		<DialogBody
			className={cn(
				"pb-[calc(var(--space-10)+var(--radius-shell)+env(safe-area-inset-bottom))]",
				className,
			)}
			{...props}
		/>
	);
}
