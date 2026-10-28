import { useDraggable } from "@dnd-kit/core";
import type { ResponseBlockType } from "@tripwire/contracts";
import { PickerRow, PickerRowAction } from "#/components/common/grouped-picker";
import { Add } from "#/components/glaze/icon";
import type { BlockMeta } from "#/components/responses/blocks/block-catalog";
import type { BlockDragData } from "#/components/responses/blocks/use-block-dnd";
import { cn } from "#/lib/glaze/utils";

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
			action={
				<PickerRowAction
					aria-label={`Add ${meta.label}`}
					disabled={disabled}
					glyph={Add}
					onClick={add}
					reveal="hover"
				/>
			}
			className={cn(!disabled && "cursor-grab", isDragging && "opacity-40")}
			disabled={disabled}
			icon={meta.icon}
			name={meta.label}
			ref={setNodeRef}
			{...listeners}
		/>
	);
}
