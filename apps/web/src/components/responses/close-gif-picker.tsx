import type { GifsResult } from "@giphy/js-fetch-api";
import { useQueryClient } from "@tanstack/react-query";
import type { CloseGif } from "@tripwire/contracts";
import {
	lazy,
	Suspense,
	type SyntheticEvent,
	useCallback,
	useEffect,
	useState,
} from "react";
import { Button } from "#/components/glaze/ui/button";
import { Input } from "#/components/glaze/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";
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
	busy: "Search is busy, try again soon.",
	unavailable: "GIFs are not available right now.",
};

export function searchTerm(text: string): string {
	const trimmed = text.trim();
	return trimmed.length >= MIN_QUERY ? trimmed : "";
}

function useDebounced(value: string, delay: number): string {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);
	return settled;
}

function GridLoader() {
	return (
		<p className="py-3 text-center type-body-sm text-text-2">Loading GIFs</p>
	);
}

export interface CloseGifPickerProps {
	org: string;
	gif: CloseGif | null;
	disabled: boolean;
	onPick: (gif: CloseGif) => void;
}

export function CloseGifPicker({
	org,
	gif,
	disabled,
	onPick,
}: CloseGifPickerProps) {
	const [open, setOpen] = useState(false);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger
				disabled={disabled}
				render={<Button size="sm" variant="secondary" />}
			>
				{gif ? "Replace GIF" : "Add a GIF"}
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-80"
				side="bottom"
				sideOffset={8}
			>
				{open ? (
					<GifSearch
						onPick={(picked) => {
							onPick(picked);
							setOpen(false);
						}}
						org={org}
					/>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

function GifSearch({
	org,
	onPick,
}: {
	org: string;
	onPick: (gif: CloseGif) => void;
}) {
	const queryClient = useQueryClient();
	const [text, setText] = useState("");
	const query = useDebounced(searchTerm(text), SEARCH_DELAY_MS);
	const [status, setStatus] = useState<GiphyStatus>("ok");

	const fetchGifs = useCallback(
		async (offset: number): Promise<GifsResult> => {
			const page = await queryClient.fetchQuery(
				closeGifsQueryOptions(org, query, offset),
			);
			if (offset === 0 || page.status !== "ok") {
				setStatus(page.status);
			}
			return page.result;
		},
		[org, query, queryClient],
	);

	const pick = (picked: GiphyGif, event: SyntheticEvent<HTMLElement>) => {
		event.preventDefault();
		const chosen = closeGifFrom(picked);
		if (chosen) {
			onPick(chosen);
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<PopoverTitle className="sr-only">Pick a GIF</PopoverTitle>
			<Input
				aria-label="Search GIPHY"
				autoFocus
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
			<div className="-mx-1 h-90 overflow-y-auto overscroll-contain px-1">
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
