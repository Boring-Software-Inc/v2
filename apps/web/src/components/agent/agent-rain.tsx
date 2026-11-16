import { motion as Motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import type { AgentMotion } from "#/hooks/use-agent-motion";
import { cn } from "#/lib/utils";

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
	const osReduced = useReducedMotion();
	const animate = motion === "full" && !osReduced;
	return (
		<span
			aria-hidden
			className={cn("inline-grid shrink-0 grid-cols-3", className)}
			data-agent-rain={motion}
		>
			{dots.map((dot) => (
				<Motion.span
					animate={{ opacity: animate ? [0.2, 1] : 0.7 }}
					className="size-0.75"
					initial={{ opacity: 0.7 }}
					key={dot.index}
					transition={
						animate
							? {
									delay: dot.delay / 1000,
									duration: dot.duration / 1000,
									ease: [0.42, 0, 0.58, 1],
									repeat: Infinity,
									repeatType: "reverse",
								}
							: { duration: 0 }
					}
				/>
			))}
		</span>
	);
}
