import { useDraggable } from "@dnd-kit/core";
import type { ResponseBlockType } from "@tripwire/contracts";
import { Add } from "@tripwire/ui/icon";
import { PickerRow, PickerRowAction } from "#/components/common/grouped-picker";
import type { BlockMeta } from "#/components/responses/blocks/block-catalog";
import type { BlockDragData } from "#/components/responses/blocks/use-block-dnd";

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
					ariaLabel={`Add ${meta.label}`}
					disabled={disabled}
					glyph={Add}
					reveal="hover"
				/>
			}
			data-layout-role="response-block-palette-row"
			data-draggable={!disabled || undefined}
			data-dragging={isDragging || undefined}
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
