import type { CloseGif } from "@tripwire/contracts";
import { Button, IconButton } from "@tripwire/ui/button";
import { FileImage, Icon } from "@tripwire/ui/icon";
import { Popover } from "@tripwire/ui/popover";
import { useEffect, useState } from "react";
import { GifSearch } from "#/components/responses/blocks/gif-search";

export interface GifBlockPopoverProps {
	org: string;
	gif: CloseGif | null;
	onPick: (gif: CloseGif) => void;
	variant?: "primary" | "secondary";
	disabled?: boolean;
	scope?: "responses" | "workflows";
	trigger?: "label" | "icon";
	onRemove?: () => void;
}

export function GifBlockPopover({
	org,
	gif,
	onPick,
	variant = "secondary",
	disabled = false,
	scope = "responses",
	trigger = "label",
	onRemove,
}: GifBlockPopoverProps) {
	const [open, setOpen] = useState(
		trigger === "label" && !disabled && gif === null,
	);
	useEffect(() => {
		if (disabled) {
			setOpen(false);
		}
	}, [disabled]);
	const pick = (picked: CloseGif) => {
		onPick(picked);
		setOpen(false);
	};
	const triggerLabel = gif ? "Change GIF" : "Add GIF";
	const triggerControl =
		trigger === "icon" ? (
			<IconButton
				disabled={disabled}
				icon={<Icon icon={FileImage} />}
				label={triggerLabel}
				size="small"
				variant={gif ? "secondary" : "ghost"}
			/>
		) : (
			<Button disabled={disabled} size="small" variant={variant}>
				{gif ? "Change GIF" : "Pick a GIF"}
			</Button>
		);
	return (
		<Popover
			align={trigger === "icon" ? "end" : "start"}
			anchorGap="spacious"
			focusMode="trap"
			onOpenChange={(next) => setOpen(disabled ? false : next)}
			open={!disabled && open}
			placement="bottom"
			trigger={triggerControl}
			triggerLabel={triggerLabel}
		>
			<div className="w-80 overflow-hidden">
				{!disabled && open ? (
					<div data-layout-role="gif-picker-content">
						<GifSearch onPick={pick} org={org} scope={scope} />
						{gif && onRemove ? (
							<div data-layout-role="gif-picker-actions">
								<Button
									onAction={() => {
										onRemove();
										setOpen(false);
									}}
									size="small"
									variant="ghost"
								>
									Remove GIF
								</Button>
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</Popover>
	);
}
