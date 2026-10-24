import { parseDiffFromFile } from "@pierre/diffs";
import type {
	FileContents,
	FileDiffOptions,
	FileOptions,
	SelectedLineRange,
} from "@pierre/diffs/react";
import { File, FileDiff } from "@pierre/diffs/react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { DiffStats } from "#/components/code/code-header";
import {
	codeSurfaceStyle,
	registerTripwireCodeTheme,
	TRIPWIRE_CODE_THEME,
} from "#/components/code/code-theme";
import type { LineRange } from "#/components/code/line-anchor";

registerTripwireCodeTheme();

const THEMES = { light: TRIPWIRE_CODE_THEME, dark: TRIPWIRE_CODE_THEME };
const SHELL_CSS = "[data-diffs-header]{display:none}pre{padding-block:8px}";

export interface PierreFileProps {
	name: string;
	code: string;
	dark: boolean;
	wrap: boolean;
	selected: LineRange | null;
	onSelect?: (range: LineRange | null) => void;
}

export function PierreFile({
	name,
	code,
	dark,
	wrap,
	selected,
	onSelect,
}: PierreFileProps) {
	const file = useMemo<FileContents>(
		() => ({ name, contents: code }),
		[name, code],
	);
	const options = useMemo<FileOptions<undefined, undefined>>(
		() => ({
			theme: THEMES,
			themeType: dark ? "dark" : "light",
			overflow: wrap ? "wrap" : "scroll",
			unsafeCSS: SHELL_CSS,
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
	renderHeader: (stats: DiffStats) => ReactNode;
}

export function PierreDiff({
	name,
	before,
	after,
	dark,
	wrap,
	split,
	renderHeader,
}: PierreDiffProps) {
	const fileDiff = useMemo(
		() =>
			parseDiffFromFile({ name, contents: before }, { name, contents: after }),
		[name, before, after],
	);
	const stats = useMemo<DiffStats>(
		() =>
			fileDiff.hunks.reduce(
				(sum, hunk) => ({
					added: sum.added + hunk.additionLines,
					removed: sum.removed + hunk.deletionLines,
				}),
				{ added: 0, removed: 0 },
			),
		[fileDiff],
	);
	const options = useMemo<FileDiffOptions<undefined, undefined>>(
		() => ({
			theme: THEMES,
			themeType: dark ? "dark" : "light",
			overflow: wrap ? "wrap" : "scroll",
			diffStyle: split ? "split" : "unified",
			unsafeCSS: SHELL_CSS,
			diffIndicators: "bars",
			lineDiffType: "word",
			hunkSeparators: "line-info",
			lineHoverHighlight: "both",
		}),
		[dark, wrap, split],
	);
	return (
		<>
			{renderHeader(stats)}
			<FileDiff
				fileDiff={fileDiff}
				options={options}
				style={codeSurfaceStyle}
			/>
		</>
	);
}
