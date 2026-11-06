import { useDraggable } from "@dnd-kit/core";
import type { ResponseBlockType } from "@tripwire/contracts";
import { PickerRow, PickerRowAction } from "#/components/common/grouped-picker";
import type { BlockMeta } from "#/components/responses/blocks/block-catalog";
import type { BlockDragData } from "#/components/responses/blocks/use-block-dnd";
import { Add } from "#/design-system/icon";
import { cn } from "#/design-system/lib/utils";

export interface BlockPaletteItemProps {
	meta: BlockMeta;
	disabled: boolean;
	onAdd: (type: ResponseBlockType) => void;
}

export function BlockPaletteItem({
	meta,
	disabled,
	onAdd,
}: BlockPaletteItemProps) {
	const data: BlockDragData = {
		item: { source: "palette", type: meta.type },
		label: meta.label,
	};
	const { listeners, setNodeRef, isDragging } = useDraggable({
		id: `palette-${meta.type}`,
		data,
		disabled,
	});
	const add = () => onAdd(meta.type);
	return (
		<PickerRow
			aria-label={`Add ${meta.label}`}
			action={
				<PickerRowAction
					aria-label={`Add ${meta.label}`}
					disabled={disabled}
					glyph={Add}
					reveal="hover"
				/>
			}
			className={cn(
				!disabled &&
					"cursor-grab hover:bg-hover-row focus-visible:focus-ring-row",
				isDragging && "opacity-40",
			)}
			description={meta.description}
			disabled={disabled}
			icon={meta.icon}
			inset
			name={meta.label}
			onClick={add}
			ref={setNodeRef}
			{...listeners}
		/>
	);
}
