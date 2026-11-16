import { type RefObject, useLayoutEffect, useState } from "react";

interface ScheduleTokenHintProps {
	field: RefObject<HTMLDivElement | null>;
	hasProblem: boolean;
	label: string;
	scrollContainer: RefObject<HTMLSpanElement | null>;
	tokenIndex: number | null;
	tokens: RefObject<(HTMLSpanElement | null)[]>;
}

interface HintPosition {
	edge: "left" | "right";
	offset: number;
}

export function ScheduleTokenHint({
	field,
	hasProblem,
	label,
	scrollContainer,
	tokenIndex,
	tokens,
}: ScheduleTokenHintProps) {
	const [position, setPosition] = useState<HintPosition>({
		edge: "left",
		offset: 0,
	});
	useLayoutEffect(() => {
		const root = field.current;
		const mirror = scrollContainer.current;
		const token = tokenIndex === null ? null : tokens.current[tokenIndex];
		if (!(root && mirror && token)) return;

		const measure = () => {
			const fieldBounds = root.getBoundingClientRect();
			const tokenBounds = token.getBoundingClientRect();
			const left = Math.max(tokenBounds.left - fieldBounds.left, 0);
			const next: HintPosition =
				left > fieldBounds.width / 2
					? {
							edge: "right",
							offset: Math.max(fieldBounds.right - tokenBounds.right, 0),
						}
					: { edge: "left", offset: left };
			setPosition((previous) =>
				previous.edge === next.edge && previous.offset === next.offset
					? previous
					: next,
			);
		};

		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(root);
		observer.observe(token);
		mirror.addEventListener("scroll", measure);
		return () => {
			observer.disconnect();
			mirror.removeEventListener("scroll", measure);
		};
	});

	return (
		<span
			className="content-caption"
			data-layout-role="schedule-token-hint"
			data-has-problem={hasProblem || undefined}
			style={{ [position.edge]: position.offset }}
		>
			{label}
		</span>
	);
}
