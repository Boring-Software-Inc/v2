import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { ResponseBlock } from "@tripwire/contracts";
import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { DragHandle, Icon } from "#/components/glaze/icon";
import { BLOCK_META } from "#/components/responses/blocks/block-catalog";
import type { BlockDragData } from "#/components/responses/blocks/use-block-dnd";
import { cn, mergeRefs } from "#/lib/glaze/utils";

export interface BlockRowProps {
	block: ResponseBlock;
	selected: boolean;
	lifted: boolean;
	placeholder: boolean;
	readOnly: boolean;
	onSelect: (id: string | null) => void;
	children: ReactNode;
}

export function BlockRow({
	block,
	selected,
	lifted,
	placeholder,
	readOnly,
	onSelect,
	children,
}: BlockRowProps) {
	const label = BLOCK_META[block.type].label;
	const data: BlockDragData = {
		item: { source: "canvas", id: block.id },
		label,
	};
	const drag = useDraggable({ id: block.id, data, disabled: readOnly });
	const drop = useDroppable({ id: block.id, data });
	const handle = useRef<HTMLButtonElement>(null);
	const select = () => onSelect(block.id);
	const leave = (event: KeyboardEvent<HTMLLIElement>) => {
		if (
			event.key === "Escape" &&
			selected &&
			event.currentTarget.contains(event.target as Node)
		) {
			event.preventDefault();
			onSelect(null);
			handle.current?.focus();
		}
	};

	return (
		<li
			className={cn(
				"group/block relative rounded-panel px-2 py-1.5 type-body text-text-1 max-sm:ps-7",
				selected
					? "bg-paper ring-1 ring-line-strong"
					: !readOnly && "hover:bg-hover",
				lifted && "opacity-30",
			)}
			data-block={block.type}
			data-empty-block={placeholder || undefined}
			onKeyDown={leave}
			ref={mergeRefs(drag.setNodeRef, drop.setNodeRef)}
		>
			{children}
			{readOnly || selected ? null : (
				<button
					aria-hidden
					className="absolute inset-0 cursor-pointer rounded-panel"
					onClick={select}
					tabIndex={-1}
					type="button"
				/>
			)}
			{readOnly ? null : (
				<button
					aria-label={label}
					className={cn(
						"-start-9.5 max-sm:start-1.5 absolute top-1.5 flex h-5.5 w-4 cursor-grab items-center justify-center rounded-tag text-text-3 opacity-0 transition-opacity duration-(--dur-state) hover:text-text-1 focus-visible:opacity-100 focus-visible:focus-sm group-hover/block:opacity-100 pointer-coarse:opacity-100",
						selected && "opacity-100",
					)}
					onClick={select}
					ref={mergeRefs(drag.setActivatorNodeRef, handle)}
					type="button"
					{...drag.attributes}
					{...drag.listeners}
				>
					<Icon icon={DragHandle} size={14} />
				</button>
			)}
		</li>
	);
}
