import { motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "#/lib/glaze/utils";

export interface AnimatedHeightProps {
	children: ReactNode;
	className?: string;
}

export function AnimatedHeight({ children, className }: AnimatedHeightProps) {
	const inner = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState<number | "auto">("auto");

	useEffect(() => {
		const el = inner.current;
		if (!el) {
			return;
		}
		const observer = new ResizeObserver(([entry]) => {
			const size = entry?.borderBoxSize[0]?.blockSize;
			if (size !== undefined) {
				setHeight(size);
			}
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	return (
		<motion.div
			animate={{ height }}
			className={cn(
				"overflow-clip [overflow-clip-margin:var(--space-2)]",
				className,
			)}
			initial={false}
		>
			<div className="relative" ref={inner}>
				{children}
			</div>
		</motion.div>
	);
}
