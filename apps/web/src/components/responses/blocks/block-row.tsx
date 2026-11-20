import type { ResponseBlock } from "@tripwire/contracts";
import { motion, useReducedMotion } from "motion/react";
import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { BLOCK_META } from "#/components/responses/blocks/block-catalog";
import { cn } from "#/lib/utils";

const LOCAL_APPEARANCE = {
	root: "group/block relative snap-center snap-always scroll-m-24 rounded-panel px-2 py-1.5 type-body text-text-1 transition-[opacity,filter,transform] duration-(--dur-state) max-sm:ps-7 motion-reduce:transition-none",
	selected: "bg-paper ring-1 ring-line-strong",
	hover: "hover:bg-hover",
	dimmed: "scale-[0.996] opacity-[0.42] blur-[0.75px]",
	node61_1:
		"pointer-events-none absolute -inset-1 z-10 rounded-[calc(var(--radius-panel)+4px)] border-2 border-[#58a6ff]/80 bg-[#58a6ff]/4 shadow-[0_0_0_1px_color-mix(in_oklab,#58a6ff_18%,transparent)]",
	node74_2: "absolute inset-0 cursor-pointer rounded-panel",
} as const;

export interface BlockRowProps {
	block: ResponseBlock;
	selected: boolean;
	placeholder: boolean;
	readOnly: boolean;
	dimmed: boolean;
	onSelect: (id: string | null) => void;
	onNavigate: (direction: -1 | 1) => void;
	children: ReactNode;
}

export function BlockRow({
	block,
	selected,
	placeholder,
	readOnly,
	dimmed,
	onSelect,
	onNavigate,
	children,
}: BlockRowProps) {
	const label = BLOCK_META[block.type].label;
	const editButton = useRef<HTMLButtonElement>(null);
	const row = useRef<HTMLLIElement>(null);
	const reduceMotion = useReducedMotion();
	const select = () => onSelect(block.id);
	const leave = (event: KeyboardEvent<HTMLLIElement>) => {
		if (
			event.key === "Escape" &&
			selected &&
			event.currentTarget.contains(event.target as Node)
		) {
			event.preventDefault();
			editButton.current?.focus();
		}
	};
	return (
		<li
			className={cn(
				LOCAL_APPEARANCE.root,
				selected
					? LOCAL_APPEARANCE.selected
					: !readOnly && LOCAL_APPEARANCE.hover,
				dimmed && LOCAL_APPEARANCE.dimmed,
			)}
			data-block={block.type}
			data-block-id={block.id}
			data-empty-block={placeholder || undefined}
			onKeyDown={leave}
			ref={row}
		>
			{selected ? (
				<motion.span
					aria-hidden
					className={LOCAL_APPEARANCE.node61_1}
					layoutId="response-preview-focus"
					transition={
						reduceMotion
							? { duration: 0 }
							: { type: "spring", stiffness: 320, damping: 34, mass: 0.82 }
					}
				/>
			) : null}
			{children}
			{readOnly ? null : (
				<button
					aria-label={`Edit ${label}`}
					className={LOCAL_APPEARANCE.node74_2}
					onClick={select}
					onKeyDown={(event) => {
						if (event.key === "ArrowDown" || event.key === "PageDown") {
							event.preventDefault();
							onNavigate(1);
						}
						if (event.key === "ArrowUp" || event.key === "PageUp") {
							event.preventDefault();
							onNavigate(-1);
						}
					}}
					ref={editButton}
					type="button"
				/>
			)}
		</li>
	);
}
