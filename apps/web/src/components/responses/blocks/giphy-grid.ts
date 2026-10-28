import { Grid } from "@giphy/react-components";
import type { GiphyGifRecord, GiphyPageRecord } from "@tripwire/contracts";
import type { ComponentProps, ComponentType, SyntheticEvent } from "react";

type SdkGridProps = ComponentProps<typeof Grid>;

export interface GiphyGridProps
	extends Pick<
		SdkGridProps,
		| "columns"
		| "gutter"
		| "width"
		| "loader"
		| "noResultsMessage"
		| "onGifsFetchError"
		| "tabIndex"
		| "eagerIds"
	> {
	fetchGifs: (offset: number) => Promise<GiphyPageRecord>;
	initialGifs?: GiphyGifRecord[];
	hideAttribution: true;
	noLink: true;
	onGifClick?: (
		gif: GiphyGifRecord,
		event: SyntheticEvent<HTMLElement>,
	) => void;
	onGifKeyPress?: (
		gif: GiphyGifRecord,
		event: SyntheticEvent<HTMLElement>,
	) => void;
}

/** Grid's full-GIF declaration overstates the fields read with links and attribution off. */
export const GiphyGrid: ComponentType<GiphyGridProps> = Grid as typeof Grid &
	ComponentType<GiphyGridProps>;
