import { useMemo } from "react";
import type { AgentMotion } from "#/hooks/use-agent-motion";
import { cn } from "#/lib/glaze/utils";

const DOTS = 6;

function pulses(seed: string) {
	let h = 0;
	for (const char of seed) {
		h = (h * 31 + char.charCodeAt(0)) >>> 0;
	}
	return Array.from({ length: DOTS }, (_, index) => {
		h = (h * 1103515245 + 12345) >>> 0;
		const duration = 700 + (h % 300);
		h = (h * 1103515245 + 12345) >>> 0;
		return { index, duration, delay: -(h % duration) };
	});
}

/** Six blue squares, three by two, each pulsing on its own beat. */
export function AgentRain({
	motion,
	seed = "agent",
	className,
}: {
	motion: AgentMotion;
	seed?: string;
	className?: string;
}) {
	const dots = useMemo(() => pulses(seed), [seed]);
	return (
		<span
			aria-hidden
			className={cn("inline-grid shrink-0 grid-cols-3 gap-px", className)}
			data-agent-rain={motion}
		>
			{dots.map((dot) => (
				<span
					className="size-0.75 bg-agent"
					key={dot.index}
					style={{
						animationDuration: `${dot.duration}ms`,
						animationDelay: `${dot.delay}ms`,
					}}
				/>
			))}
		</span>
	);
}
