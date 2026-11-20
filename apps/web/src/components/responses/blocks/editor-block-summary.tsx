import type { ResponseBlockType } from "@tripwire/contracts";
import { Icon } from "@tripwire/ui/icon";
import { BLOCK_META } from "#/components/responses/blocks/block-catalog";
import { cn } from "#/lib/utils";

const LOCAL_APPEARANCE = {
	root: "flex min-w-0 items-center gap-3",
	node19_1: "shrink-0 text-text-2",
	node22_2: "min-w-0 flex-1",
	node23_3: "block type-label text-text-1",
	node24_4: "block truncate type-caption text-text-2",
} as const;

export interface EditorBlockSummaryProps {
	type: ResponseBlockType;
	className?: string;
}

export function EditorBlockSummary({
	type,
	className,
}: EditorBlockSummaryProps) {
	const meta = BLOCK_META[type];

	return (
		<span className={cn(LOCAL_APPEARANCE.root, className)}>
			<span className={LOCAL_APPEARANCE.node19_1}>
				<Icon icon={meta.icon} />
			</span>
			<span className={LOCAL_APPEARANCE.node22_2}>
				<span className={LOCAL_APPEARANCE.node23_3}>{meta.label}</span>
				<span className={LOCAL_APPEARANCE.node24_4}>{meta.description}</span>
			</span>
		</span>
	);
}
