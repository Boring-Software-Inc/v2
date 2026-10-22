import type { HTMLMotionProps, Transition } from "motion/react";

export const PREVIEW_TRANSITION: Transition = {
	duration: 0.28,
	ease: [0.22, 1, 0.36, 1],
};

export const BLUR_SWAP = {
	initial: { opacity: 0, filter: "blur(6px)" },
	animate: { opacity: 1, filter: "blur(0px)" },
	exit: { opacity: 0, filter: "blur(6px)" },
} satisfies HTMLMotionProps<"div">;

export function keyedByContent<T>(
	items: readonly T[],
	contentOf: (item: T) => string,
): { item: T; key: string }[] {
	const counts = new Map<string, number>();
	return items.map((item) => {
		const content = contentOf(item);
		const seen = counts.get(content) ?? 0;
		counts.set(content, seen + 1);
		return { item, key: seen === 0 ? content : `${content}#${seen}` };
	});
}
