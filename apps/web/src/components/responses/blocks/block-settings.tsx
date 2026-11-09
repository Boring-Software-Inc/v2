import type { CloseGif, ResponseBlock } from "@tripwire/contracts";
import { failedRulesStyleSchema } from "@tripwire/contracts";
import type { ComponentProps } from "react";
import { BLOCK_META } from "#/components/responses/blocks/block-catalog";
import { GifBlockPopover } from "#/components/responses/blocks/gif-block-popover";
import { TextBlockEditor } from "#/components/responses/blocks/text-block-editor";
import { Icon } from "#/design-system/icon";
import { Field, FieldDescription, FieldLabel } from "#/design-system/ui/field";
import { RadioGroup, RadioGroupOption } from "#/design-system/ui/radio-group";
import { Textarea } from "#/design-system/ui/textarea";

export interface BlockSettingsProps {
	block: ResponseBlock;
	readOnly: boolean;
	org: string;
	rulesHidden: boolean;
	helpDefaultContent: string;
	onUpdate: (block: ResponseBlock) => void;
}

const STYLE_OPTIONS = {
	full: {
		label: "Full details",
		description: "Shows each failed rule with its result and any fix hint.",
	},
	"one-liner": {
		label: "Contributor summary",
		description:
			"Uses the rule's contributor-facing label. Falls back to full details when no label is configured.",
	},
} as const;

export function BlockSettings({
	block,
	readOnly,
	org,
	rulesHidden,
	helpDefaultContent,
	onUpdate,
}: BlockSettingsProps) {
	const meta = BLOCK_META[block.type];
	const setStyle: NonNullable<
		ComponentProps<typeof RadioGroup>["onValueChange"]
	> = (value) => {
		const style = failedRulesStyleSchema.safeParse(value);
		if (block.type === "failed-rules" && style.success) {
			onUpdate({ ...block, style: style.data });
		}
	};
	const pickGif = (gif: CloseGif) => {
		if (block.type === "gif") {
			onUpdate({ ...block, gif });
		}
	};
	const setHelpContent = (content: string) => {
		if (block.type === "help") {
			onUpdate({ ...block, content });
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4">
			<h2 className="flex items-center gap-2 type-label-lg">
				<Icon className="text-text-1" icon={meta.icon} />
				{meta.label}
			</h2>
			{block.type === "failed-rules" ? (
				<div className="flex flex-col gap-2">
					<p className="type-body-sm text-text-2">
						Choose how much detail each failed rule includes in the response.
					</p>
					<RadioGroup
						aria-label="Failed rule detail"
						disabled={readOnly}
						onValueChange={setStyle}
						value={block.style}
					>
						{failedRulesStyleSchema.options.map((style) => (
							<RadioGroupOption
								description={STYLE_OPTIONS[style].description}
								key={style}
								label={STYLE_OPTIONS[style].label}
								value={style}
							/>
						))}
					</RadioGroup>
				</div>
			) : null}
			{block.type === "ai-notice" ? (
				<p className="type-body-sm text-text-2">
					Adds “AI review did not run.” when the org is out of AI credits.
					Otherwise, this block is omitted.
				</p>
			) : null}
			{block.type === "help" ? (
				<Field disabled={readOnly}>
					<FieldLabel>Expanded content</FieldLabel>
					<Textarea
						autoGrow
						limit={4000}
						maxRows={12}
						minRows={6}
						onValueChange={setHelpContent}
						value={block.content ?? helpDefaultContent}
					/>
					<FieldDescription>
						Shown after a contributor expands “How do I fix this?”.
					</FieldDescription>
				</Field>
			) : null}
			{block.type === "text" ? (
				<TextBlockEditor
					block={block}
					onChange={onUpdate}
					rulesHidden={rulesHidden}
				/>
			) : null}
			{block.type === "gif" ? (
				<GifBlockPopover gif={block.gif} onPick={pickGif} org={org} />
			) : null}
		</div>
	);
}
