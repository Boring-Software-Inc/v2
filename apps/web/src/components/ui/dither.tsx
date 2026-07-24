"use client";

import { Dithering } from "@paper-design/shaders-react";
import { useTheme } from "next-themes";
import { useHasMounted } from "#/hooks/use-has-mounted";
import { cn } from "#/lib/utils";

type DitherShape =
	| "simplex"
	| "warp"
	| "dots"
	| "wave"
	| "ripple"
	| "swirl"
	| "sphere";
type DitherType = "random" | "2x2" | "4x4" | "8x8";

export type DitherProps = {
	/** Speckle ink. Defaults to a theme-aware neutral (light on dark, dark on
	 * light) so it also contrasts against the theme-inverted `primary` button. */
	colorFront?: string;
	/** Base behind the speckle. Transparent by default so the layer composites
	 * over whatever surface it sits on. */
	colorBack?: string;
	shape?: DitherShape;
	type?: DitherType;
	size?: number;
	scale?: number;
	/** 0 = static texture (cheap). The banner opts into motion. */
	speed?: number;
	className?: string;
};

/**
 * House dither texture — a thin wrapper over Paper's `Dithering` shader with the
 * params caleb tuned on the beta banner. Drop it as the first child of a
 * `relative` box: it fills the box, sits behind siblings, and never eats pointer
 * events.
 *
 * WebGL can't read our CSS custom properties, so the ink resolves off the
 * resolved theme rather than a `--surface-*` token. Renders nothing until
 * mounted (decorative, and avoids an SSR/client theme mismatch).
 */
export function Dither({
	colorFront,
	colorBack = "#00000000",
	shape = "simplex",
	type = "8x8",
	size = 2.8,
	scale = 0.55,
	speed = 0,
	className,
}: DitherProps) {
	const mounted = useHasMounted();
	const { resolvedTheme } = useTheme();
	if (!mounted) {
		return null;
	}
	// Ink must clear the surfaces it lands on (bg-card ~#1c1c1f AND surface-2
	// ~#2a2a2e in dark) — too close and the speckle vanishes, as it did on the
	// beta banner. A lighter dark ink reads on both.
	const ink = colorFront ?? (resolvedTheme === "dark" ? "#47474f" : "#c7c7cd");
	return (
		<Dithering
			className={cn(
				"pointer-events-none absolute inset-0 h-full w-full",
				className,
			)}
			colorBack={colorBack}
			colorFront={ink}
			height="100%"
			scale={scale}
			shape={shape}
			size={size}
			speed={speed}
			type={type}
			width="100%"
		/>
	);
}
