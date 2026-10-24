import type {
	FileContents,
	FileDiffOptions,
	FileOptions,
	SelectedLineRange,
} from "@pierre/diffs/react";
import { File, MultiFileDiff } from "@pierre/diffs/react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
	codeSurfaceStyle,
	registerTripwireCodeTheme,
	TRIPWIRE_CODE_THEME,
} from "#/components/code/code-theme";
import type { LineRange } from "#/components/code/line-anchor";

registerTripwireCodeTheme();

const THEMES = { light: TRIPWIRE_CODE_THEME, dark: TRIPWIRE_CODE_THEME };

export interface PierreFileProps {
	name: string;
	code: string;
	dark: boolean;
	wrap: boolean;
	selected: LineRange | null;
	onSelect?: (range: LineRange | null) => void;
	header: ReactNode;
}

export function PierreFile({
	name,
	code,
	dark,
	wrap,
	selected,
	onSelect,
	header,
}: PierreFileProps) {
	const file = useMemo<FileContents>(
		() => ({ name, contents: code, cacheKey: `${name}:${code.length}` }),
		[name, code],
	);
	const options = useMemo<FileOptions<undefined, undefined>>(
		() => ({
			theme: THEMES,
			themeType: dark ? "dark" : "light",
			overflow: wrap ? "wrap" : "scroll",
			lineHoverHighlight: "both",
			enableLineSelection: onSelect !== undefined,
			onLineSelected: onSelect
				? (range: SelectedLineRange | null) =>
						onSelect(range ? { start: range.start, end: range.end } : null)
				: undefined,
		}),
		[dark, wrap, onSelect],
	);
	return (
		<File
			file={file}
			options={options}
			renderHeaderMetadata={() => header}
			selectedLines={selected}
			style={codeSurfaceStyle}
		/>
	);
}

export interface PierreDiffProps {
	name: string;
	before: string;
	after: string;
	dark: boolean;
	wrap: boolean;
	split: boolean;
	header: ReactNode;
}

export function PierreDiff({
	name,
	before,
	after,
	dark,
	wrap,
	split,
	header,
}: PierreDiffProps) {
	const oldFile = useMemo<FileContents>(
		() => ({ name, contents: before }),
		[name, before],
	);
	const newFile = useMemo<FileContents>(
		() => ({ name, contents: after }),
		[name, after],
	);
	const options = useMemo<FileDiffOptions<undefined, undefined>>(
		() => ({
			theme: THEMES,
			themeType: dark ? "dark" : "light",
			overflow: wrap ? "wrap" : "scroll",
			diffStyle: split ? "split" : "unified",
			diffIndicators: "bars",
			lineDiffType: "word",
			hunkSeparators: "line-info",
			lineHoverHighlight: "both",
		}),
		[dark, wrap, split],
	);
	return (
		<MultiFileDiff
			newFile={newFile}
			oldFile={oldFile}
			options={options}
			renderHeaderMetadata={() => header}
			style={codeSurfaceStyle}
		/>
	);
}
