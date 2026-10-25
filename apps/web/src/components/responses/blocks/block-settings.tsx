import type { ResponseBlock } from "@tripwire/contracts";
import { failedRulesStyleSchema } from "@tripwire/contracts";
import { Icon, TrashCan } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	RadioGroup,
	RadioGroupOption,
} from "#/components/glaze/ui/radio-group";
import { BLOCK_META } from "#/components/responses/blocks/block-catalog";

export interface BlockSettingsProps {
	block: ResponseBlock;
	readOnly: boolean;
	onUpdate: (block: ResponseBlock) => void;
	onRemove: (id: string) => void;
}

const STYLE_LABELS = {
	full: "Each reason",
	"one-liner": "One line each",
} as const;

export function BlockSettings({
	block,
	readOnly,
	onUpdate,
	onRemove,
}: BlockSettingsProps) {
	const meta = BLOCK_META[block.type];
	const remove = () => onRemove(block.id);
	const setStyle = (value: unknown) => {
		const style = failedRulesStyleSchema.safeParse(value);
		if (block.type === "failed-rules" && style.success) {
			onUpdate({ ...block, style: style.data });
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3.5 pb-4">
			<h2 className="flex items-center gap-2 type-label-lg">
				<Icon className="text-text-1" icon={meta.icon} />
				{meta.label}
			</h2>
			{block.type === "failed-rules" ? (
				<RadioGroup
					aria-label="Style"
					disabled={readOnly}
					onValueChange={setStyle}
					value={block.style}
				>
					{failedRulesStyleSchema.options.map((style) => (
						<RadioGroupOption
							key={style}
							label={STYLE_LABELS[style]}
							value={style}
						/>
					))}
				</RadioGroup>
			) : null}
			{readOnly ? null : (
				<Button
					className="self-start"
					onClick={remove}
					size="sm"
					variant="secondary"
				>
					<Icon icon={TrashCan} />
					Remove block
				</Button>
			)}
		</div>
	);
}
