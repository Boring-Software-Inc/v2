import type { BlockOutcome } from "@tripwire/contracts";
import type { ComponentProps } from "react";
import { BlockPalette } from "#/components/responses/blocks/block-palette";
import { BlockSettings } from "#/components/responses/blocks/block-settings";
import type { BlockBuilder } from "#/components/responses/blocks/use-block-builder";
import { Icon, TrashCan } from "#/design-system/icon";
import {
	SheetAction,
	SheetBody,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "#/design-system/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "#/design-system/ui/tabs";

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
	const showTab: NonNullable<ComponentProps<typeof Tabs>["onValueChange"]> = (
		tab,
	) => {
		if (tab === "blocks") {
			builder.browse();
		}
	};

	return (
		<>
			<SheetHeader>
				<SheetTitle>{selected ? "Block settings" : "Add block"}</SheetTitle>
				<div className="flex items-center">
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
				</div>
			</SheetHeader>
			<SheetBody>
				{selected ? (
					<BlockSettings
						block={selected}
						helpDefaultContent={helpDefaultContent}
						key={selected.id}
						onUpdate={builder.update}
						org={org}
						readOnly={readOnly}
						rulesHidden={rulesHidden}
					/>
				) : (
					<BlockPalette
						disabled={readOnly || builder.full}
						onAdd={builder.add}
						outcome={outcome}
					/>
				)}
			</SheetBody>
			{selected && !readOnly ? (
				<SheetFooter>
					<SheetAction
						onAction={() => builder.remove(selected.id)}
						variant="destructive"
					>
						<Icon icon={TrashCan} />
						Remove block
					</SheetAction>
				</SheetFooter>
			) : null}
		</>
	);
}
