import type { CloseGif } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
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
}

export function GifBlockPopover({
	org,
	gif,
	onPick,
	variant = "secondary",
	disabled = false,
	scope = "responses",
}: GifBlockPopoverProps) {
	const [open, setOpen] = useState(!disabled && gif === null);
	useEffect(() => {
		if (disabled) {
			setOpen(false);
		}
	}, [disabled]);
	const pick = (picked: CloseGif) => {
		onPick(picked);
		setOpen(false);
	};
	return (
		<Popover
			align="start"
			anchorGap="spacious"
			focusMode="trap"
			onOpenChange={(next) => setOpen(disabled ? false : next)}
			open={!disabled && open}
			placement="bottom"
			trigger={
				<Button disabled={disabled} size="small" variant={variant}>
					{gif ? "Change GIF" : "Pick a GIF"}
				</Button>
			}
			triggerLabel={gif ? "Change GIF" : "Pick a GIF"}
		>
			<div data-layout-role="response-gif-picker">
				{!disabled && open ? (
					<GifSearch onPick={pick} org={org} scope={scope} />
				) : null}
			</div>
		</Popover>
	);
}
