import type { CloseGif } from "@tripwire/contracts";
import { useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";
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
		<Popover modal="trap-focus" onOpenChange={setOpen} open={open}>
			<PopoverTrigger render={<Button size="sm" variant="secondary" />}>
				{gif ? "Change GIF" : "Pick a GIF"}
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-80 overflow-hidden"
				collisionAvoidance={{ side: "none" }}
				side="bottom"
				sideOffset={8}
			>
				{open ? <GifSearch onPick={pick} org={org} /> : null}
			</PopoverContent>
		</Popover>
	);
}
