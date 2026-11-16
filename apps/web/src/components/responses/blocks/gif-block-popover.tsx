import type { CloseGif } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Popover } from "@tripwire/ui/popover";
import { useState } from "react";
import { GifSearch } from "#/components/responses/blocks/gif-search";

export interface GifBlockPopoverProps {
	org: string;
	gif: CloseGif | null;
	onPick: (gif: CloseGif) => void;
}

export function GifBlockPopover({ org, gif, onPick }: GifBlockPopoverProps) {
	const [open, setOpen] = useState(gif === null);
	const pick = (picked: CloseGif) => {
		onPick(picked);
		setOpen(false);
	};
	return (
		<Popover
			align="start"
			anchorGap="spacious"
			focusMode="trap"
			onOpenChange={setOpen}
			open={open}
			placement="bottom"
			trigger={
				<Button size="small" variant="secondary">
					{gif ? "Change GIF" : "Pick a GIF"}
				</Button>
			}
			triggerLabel={gif ? "Change GIF" : "Pick a GIF"}
		>
			<div data-layout-role="response-gif-picker">
				{open ? <GifSearch onPick={pick} org={org} /> : null}
			</div>
		</Popover>
	);
}
