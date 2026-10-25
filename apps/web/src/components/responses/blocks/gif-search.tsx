import type { GifsResult } from "@giphy/js-fetch-api";
import { useQueryClient } from "@tanstack/react-query";
import type { CloseGif } from "@tripwire/contracts";
import { lazy, Suspense, type SyntheticEvent, useState } from "react";
import { Input } from "#/components/glaze/ui/input";
import { PopoverTitle } from "#/components/glaze/ui/popover";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { closeGifFrom, type GiphyGif } from "#/lib/giphy-gif";
import { closeGifsQueryOptions } from "#/lib/response.query";
import type { GiphyStatus } from "#/lib/server/giphy-search";

const Grid = lazy(() =>
	import("@giphy/react-components").then((module) => ({
		default: module.Grid,
	})),
);

const SEARCH_DELAY_MS = 400;
const MIN_QUERY = 2;
const GRID_WIDTH = 296;

const STATUS_COPY: Record<Exclude<GiphyStatus, "ok">, string> = {
	busy: "GIF search is busy. Try again shortly.",
	unavailable: "GIFs are not available right now.",
};

function searchTerm(text: string): string {
	const trimmed = text.trim();
	return trimmed.length >= MIN_QUERY ? trimmed : "";
}

function GridLoader() {
	return (
		<p className="py-3 text-center type-body-sm text-text-2">Loading GIFs</p>
	);
}

export interface GifSearchProps {
	org: string;
	onPick: (gif: CloseGif) => void;
}

export function GifSearch({ org, onPick }: GifSearchProps) {
	const queryClient = useQueryClient();
	const [text, setText] = useState("");
	const query = useDebouncedValue(searchTerm(text), SEARCH_DELAY_MS);
	const [status, setStatus] = useState<GiphyStatus>("ok");

	const fetchGifs = async (offset: number): Promise<GifsResult> => {
		const page = await queryClient.fetchQuery(
			closeGifsQueryOptions(org, query, offset),
		);
		if (offset === 0 || page.status !== "ok") {
			setStatus(page.status);
		}
		return page.result;
	};

	const pick = (picked: GiphyGif, event: SyntheticEvent<HTMLElement>) => {
		event.preventDefault();
		const chosen = closeGifFrom(picked);
		if (chosen) {
			onPick(chosen);
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<PopoverTitle className="sr-only">Pick a GIF</PopoverTitle>
			<Input
				aria-label="Search GIPHY"
				autoFocus
				className="shrink-0"
				clearLabel="Clear search"
				mode="search"
				onValueChange={setText}
				placeholder="Search GIPHY"
				value={text}
			/>
			{status !== "ok" ? (
				<output className="type-body-sm text-text-2">
					{STATUS_COPY[status]}
				</output>
			) : null}
			<div className="-mx-1 h-90 min-h-0 shrink overflow-y-auto overscroll-contain px-1">
				<Suspense fallback={<GridLoader />}>
					<Grid
						columns={2}
						fetchGifs={fetchGifs}
						gutter={8}
						hideAttribution
						key={query}
						loader={GridLoader}
						noLink
						noResultsMessage={
							<p className="py-3 text-center type-body-sm text-text-2">
								No GIFs match that search.
							</p>
						}
						onGifClick={pick}
						onGifKeyPress={(picked, event) => {
							const key = (event as unknown as KeyboardEvent).key;
							if (key === "Enter" || key === " ") {
								pick(picked, event);
							}
						}}
						onGifsFetchError={() => setStatus("unavailable")}
						tabIndex={0}
						width={GRID_WIDTH}
					/>
				</Suspense>
			</div>
			<a
				className="self-end type-caption text-text-2 underline-offset-2 hover:underline"
				href="https://giphy.com"
				rel="noreferrer"
				target="_blank"
			>
				Powered by GIPHY
			</a>
		</div>
	);
}
