import type { BlockOutcome } from "@tripwire/contracts";
import { ChevronLeft, ChevronRight, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { Tabs, TabsList, TabsTrigger } from "#/components/glaze/ui/tabs";
import { BlockPalette } from "#/components/responses/blocks/block-palette";
import { BlockSettings } from "#/components/responses/blocks/block-settings";
import type { BlockBuilder } from "#/components/responses/blocks/use-block-builder";

export interface BlockColumnProps {
	builder: BlockBuilder;
	outcome: BlockOutcome;
	readOnly: boolean;
}

export function BlockColumn({ builder, outcome, readOnly }: BlockColumnProps) {
	const { selected, paletteOpen } = builder;
	const expand = () => builder.showPalette(true);
	const collapse = () => builder.showPalette(false);
	const showTab = (tab: unknown) => {
		if (tab === "blocks") {
			builder.browse();
		}
	};

	if (!(paletteOpen || selected)) {
		return (
			<div className="flex lg:flex-col">
				<Button
					aria-label="Show blocks"
					onClick={expand}
					size="icon-sm"
					variant="secondary"
				>
					<Icon icon={ChevronRight} />
				</Button>
			</div>
		);
	}

	return (
		<div className="shell flex min-h-0 flex-col lg:w-66" data-block-column="">
			<div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
				<div className="flex shrink-0 items-center justify-between gap-2 border-line-faint border-b px-2 py-1.5">
					<Tabs
						onValueChange={showTab}
						value={selected ? "settings" : "blocks"}
					>
						<TabsList aria-label="Blocks" size="sm">
							<TabsTrigger value="blocks">Blocks</TabsTrigger>
							<TabsTrigger disabled={!selected} value="settings">
								Settings
							</TabsTrigger>
						</TabsList>
					</Tabs>
					<Button
						aria-label="Hide blocks"
						onClick={collapse}
						size="icon-sm"
						variant="ghost"
					>
						<Icon icon={ChevronLeft} />
					</Button>
				</div>
				{selected ? (
					<BlockSettings
						block={selected}
						key={selected.id}
						onRemove={builder.remove}
						onUpdate={builder.update}
						readOnly={readOnly}
					/>
				) : (
					<BlockPalette
						disabled={readOnly || builder.full}
						onAdd={builder.add}
						outcome={outcome}
					/>
				)}
			</div>
		</div>
	);
}
