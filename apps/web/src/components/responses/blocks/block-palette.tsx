import type { BlockOutcome, ResponseBlockType } from "@tripwire/contracts";
import { GroupedPicker } from "#/components/common/grouped-picker";
import {
	BLOCK_GROUPS,
	type BlockMeta,
	offeredBlocks,
} from "#/components/responses/blocks/block-catalog";
import { BlockPaletteItem } from "#/components/responses/blocks/block-palette-item";

export interface BlockPaletteProps {
	outcome: BlockOutcome;
	disabled: boolean;
	onAdd: (type: ResponseBlockType) => void;
}

const OPEN_BY_DEFAULT = ["text", "run", "links", "media"];

function matches(meta: BlockMeta, needle: string): boolean {
	return meta.label.toLowerCase().includes(needle);
}

export function BlockPalette({ outcome, disabled, onAdd }: BlockPaletteProps) {
	const offered = offeredBlocks(outcome);
	const groups = BLOCK_GROUPS.map((group) => ({
		...group,
		items: offered.filter((meta) => meta.group === group.key),
	})).filter((group) => group.items.length > 0);

	return (
		<GroupedPicker
			defaultOpen={OPEN_BY_DEFAULT}
			groups={groups}
			matches={matches}
			noun="blocks"
			renderItem={(meta) => (
				<BlockPaletteItem
					disabled={disabled}
					key={meta.type}
					meta={meta}
					onAdd={onAdd}
				/>
			)}
		/>
	);
}
