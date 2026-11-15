import type { BlockOutcome } from "@tripwire/contracts";
import { Button, IconButton } from "@tripwire/ui/button";
import { Close, Icon, TrashCan } from "@tripwire/ui/icon";
import { Tabs } from "@tripwire/ui/tabs";
import { Subheading } from "@tripwire/ui/typography";
import { useState } from "react";
import { BlockPalette } from "#/components/responses/blocks/block-palette";
import { BlockSettings } from "#/components/responses/blocks/block-settings";
import type { BlockBuilder } from "#/components/responses/blocks/use-block-builder";

export interface BlockColumnProps {
	builder: BlockBuilder;
	outcome: BlockOutcome;
	readOnly: boolean;
	org: string;
	rulesHidden: boolean;
	helpDefaultContent: string;
}

export function BlockColumn({
	builder,
	outcome,
	readOnly,
	org,
	rulesHidden,
	helpDefaultContent,
}: BlockColumnProps) {
	const { selected } = builder;
	const [tab, setTab] = useState(selected ? "settings" : "blocks");
	const settings = tab === "settings";

	return (
		<div data-layout-role="response-block-column">
			<header data-layout-role="response-block-heading">
				<Subheading>{settings ? "Block settings" : "Add block"}</Subheading>
				<Tabs
					ariaLabel="Blocks"
					items={[
						{ label: "Blocks", value: "blocks" },
						{ disabled: !selected, label: "Settings", value: "settings" },
					]}
					onValueChange={(next) => {
						if (next === "blocks" || next === "settings") setTab(next);
					}}
					panelMode="external"
					value={tab}
				/>
				<div data-layout-role="response-block-close">
					<IconButton
						icon={<Icon icon={Close} />}
						label="Close block editor"
						onAction={() => builder.showPalette(false)}
						size="small"
						variant="ghost"
					/>
				</div>
			</header>
			<div data-layout-role="response-block-body">
				{settings && selected ? (
					<BlockSettings
						block={selected}
						helpDefaultContent={helpDefaultContent}
						key={selected.id}
						onUpdate={builder.update}
						org={org}
						readOnly={readOnly}
						rulesHidden={rulesHidden}
					/>
				) : settings ? (
					<p className="content-body-small tone-content-secondary">
						Select a block in the preview, or add one from Blocks, to edit its
						settings.
					</p>
				) : (
					<BlockPalette
						disabled={readOnly || builder.full}
						onAdd={builder.add}
						outcome={outcome}
					/>
				)}
			</div>
			{settings && selected && !readOnly ? (
				<footer data-layout-role="response-block-footer">
					<Button
						confirmation={{
							confirmLabel: "Remove block",
							description:
								"This response block will be removed after you save the response.",
							title: "Remove this block?",
						}}
						onAction={() => builder.remove(selected.id)}
						variant="destructive"
					>
						<Icon icon={TrashCan} />
						Remove block
					</Button>
				</footer>
			) : null}
		</div>
	);
}
