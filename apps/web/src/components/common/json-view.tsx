"use client";

import type { JsonValue } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { CopyButton } from "@tripwire/ui/copy-button";
import {
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { z } from "zod";
import "./json-view.css";

function Glyph({
	name,
}: {
	name: "caret" | "clear" | "collapse" | "expand" | "search";
}) {
	const path = {
		caret: "m4 2 4 4-4 4",
		clear: "m3 3 6 6m0-6L3 9",
		collapse: "M2 4h8M2 8h8",
		expand: "M6 2v8M2 6h8",
		search: "m8.5 8.5 2 2M5.5 9A3.5 3.5 0 1 1 5.5 2a3.5 3.5 0 0 1 0 7Z",
	}[name];
	return (
		<svg aria-hidden className="size-3" viewBox="0 0 12 12">
			<title>{name}</title>
			<path d={path} fill="none" stroke="currentColor" strokeLinecap="round" />
		</svg>
	);
}

function HighlightedText({
	current,
	marks,
	value,
}: {
	current?: number;
	marks?: [number, number][];
	value: string;
}) {
	if (!marks?.length) return <>{value}</>;
	const parts: ReactNode[] = [];
	let offset = 0;
	for (const [index, [start, end]] of marks.entries()) {
		if (start > offset) parts.push(value.slice(offset, start));
		parts.push(
			<mark
				className={index === current ? "json-match-current" : "json-match"}
				key={`${start}-${end}`}
			>
				{value.slice(start, end)}
			</mark>,
		);
		offset = end;
	}
	if (offset < value.length) parts.push(value.slice(offset));
	return <>{parts}</>;
}

// Tripwire's JSON view: structured output (a tool result, a run's payload, a trace span's attributes) as a foldable tree
// on code-surface, paper with the panel's hairline. A toolbar row (search, open all, close all, copy), the tree in
// type-code-block (12px, unscaled), and the focused node's path in a row under it, each split by a hairline.
//
// Ink at its steps, as in Code block: keys, strings and numbers text-1, punctuation text-2, a folded branch says how
// much it hides in text-2. A string over 120 characters folds to its first 80 with a "+n chars" button. Search finds
// keys and values, opens the branches that hold a match and hides the rest; Enter steps through matches. The tree
// follows the WAI-ARIA tree pattern: one tab stop, arrows to move, Right and Left to open and close. Code stays left
// to right inside a right-to-left page.
//
// The detail from the job: the path row shows the focused node's JSONPath, $.steps[2].output.tool, with a copy
// button, so a value found by search or by arrowing goes into code, a jq filter or a bug report without counting
// brackets.

type RowKey =
	| { kind: "field"; value: string }
	| { kind: "index"; value: number };

interface Row {
	path: string;
	parent?: string;
	key?: RowKey;
	literal: string;
	kind: "object" | "array" | "string" | "scalar";
	depth: number;
	size: number;
	last: boolean;
}

const STRING_VALUE = z.string();
const OBJECT_VALUE = z.record(z.string(), z.custom<JsonValue>());

function flatten(value: JsonValue): Row[] {
	const rows: Row[] = [];
	const walk = (
		value: JsonValue,
		segments: (string | number)[],
		key: RowKey | undefined,
		parent: string | undefined,
		last: boolean,
	) => {
		const path = JSON.stringify(segments);
		const entries: { key: RowKey; value: JsonValue }[] = [];
		let kind: Row["kind"];
		let literal: string;
		if (Array.isArray(value)) {
			kind = "array";
			literal = "[]";
			for (const [index, child] of value.entries()) {
				entries.push({ key: { kind: "index", value: index }, value: child });
			}
		} else {
			const object = OBJECT_VALUE.safeParse(value);
			if (object.success) {
				kind = "object";
				literal = "{}";
				for (const [field, child] of Object.entries(object.data)) {
					entries.push({ key: { kind: "field", value: field }, value: child });
				}
			} else {
				kind = STRING_VALUE.safeParse(value).success ? "string" : "scalar";
				literal = JSON.stringify(value);
			}
		}
		rows.push({
			path,
			parent,
			key,
			literal,
			kind,
			depth: segments.length,
			size: entries.length,
			last,
		});
		entries.forEach((entry, index) => {
			walk(
				entry.value,
				[...segments, entry.key.value],
				entry.key,
				path,
				index === entries.length - 1,
			);
		});
	};
	walk(value, [], undefined, undefined, true);
	return rows;
}

const ROOT = "[]";

/** JSONPath for a row: $.steps[2]["user agent"]. */
function pathOf(row: Row, byPath: Map<string, Row>): string {
	const parts: string[] = [];
	for (
		let r: Row | undefined = row;
		r && r.key !== undefined;
		r = r.parent ? byPath.get(r.parent) : undefined
	) {
		parts.unshift(
			r.key.kind === "index"
				? `[${r.key.value}]`
				: /^[A-Za-z_$][\w$]*$/.test(r.key.value)
					? `.${r.key.value}`
					: `[${JSON.stringify(r.key.value)}]`,
		);
	}
	return `$${parts.join("")}`;
}

const FOLD_AT = 120;
const FOLD_TO = 80;

const isBranch = (row: Row) =>
	(row.kind === "object" || row.kind === "array") && row.size > 0;
function findAll(text: string, q: string): [number, number][] {
	if (!q) return [];
	const out: [number, number][] = [];
	const hay = text.toLowerCase();
	let at = hay.indexOf(q);
	while (at >= 0) {
		out.push([at, at + q.length]);
		at = hay.indexOf(q, at + q.length);
	}
	return out;
}

/** 0 while the box's content overflows it, so keyboard readers can Tab in and scroll; undefined while it fits. */
function useScrollTabStop(ref: RefObject<HTMLElement | null>): 0 | undefined {
	const [scrolls, setScrolls] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () =>
			setScrolls(
				el.scrollWidth > el.clientWidth + 1 ||
					el.scrollHeight > el.clientHeight + 1,
			);
		const resize = new ResizeObserver(measure);
		resize.observe(el);
		for (const child of el.children) resize.observe(child);
		measure();
		return () => resize.disconnect();
	}, [ref]);
	return scrolls ? 0 : undefined;
}

type JsonViewProps = Omit<
	React.ComponentProps<"div">,
	"children" | "onCopy"
> & {
	/** Any JSON-serialisable value. */
	data: JsonValue;
	/** Branches shallower than this start open. 0 starts fully closed. */
	defaultExpandDepth?: number;
	/** Show the search field and the open-all and close-all buttons. */
	toolbar?: boolean;
	/** Show the copy button, which copies the whole value as formatted JSON. */
	copy?: boolean;
	/** The tree's accessible name. */
	label?: string;
	/** Show the focused node's path with a copy button under the tree. Defaults to toolbar. */
	path?: boolean;
};

function JsonView({
	data,
	defaultExpandDepth = 2,
	toolbar = true,
	copy = true,
	label = "JSON",
	path,
	className,
	...props
}: JsonViewProps) {
	const rows = useMemo(() => flatten(data), [data]);
	const byPath = useMemo(() => new Map(rows.map((r) => [r.path, r])), [rows]);
	const [open, setOpen] = useState(
		() =>
			new Set(
				rows
					.filter((r) => isBranch(r) && r.depth < defaultExpandDepth)
					.map((r) => r.path),
			),
	);
	const [query, setQuery] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
	const [current, setCurrent] = useState(0);
	const [focused, setFocused] = useState(ROOT);
	const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const treeRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const bodyTab = useScrollTabStop(bodyRef);
	const pressedFocused = useRef(false);
	const q = query.trim().toLowerCase();

	// Matching rows; their ancestors open, and nothing else stays on screen while searching.
	const { matches, keep, ancestors } = useMemo(() => {
		const matches: string[] = [];
		const keep = new Set<string>();
		const ancestors = new Set<string>();
		if (!q) return { matches, keep, ancestors };
		for (const row of rows) {
			const hit =
				(row.key !== undefined &&
					String(row.key.value).toLowerCase().includes(q)) ||
				(!isBranch(row) && row.literal.toLowerCase().includes(q));
			if (!hit) continue;
			matches.push(row.path);
			keep.add(row.path);
			for (let p = row.parent; p; p = byPath.get(p)?.parent) {
				keep.add(p);
				ancestors.add(p);
			}
		}
		return { matches, keep, ancestors };
	}, [q, rows, byPath]);

	const isOpen = (p: string) => (q ? ancestors.has(p) : open.has(p));

	// The flat render list: rows, plus a closing bracket after the last visible descendant of each open branch.
	const { visible, items } = useMemo(() => {
		const visible: Row[] = [];
		const items: { row: Row; close?: boolean }[] = [];
		const stack: Row[] = [];
		let closedDepth = Infinity;
		for (const row of rows) {
			if (row.depth > closedDepth) continue;
			closedDepth = Infinity;
			if (q && !keep.has(row.path)) continue;
			while (stack.length && stack[stack.length - 1].depth >= row.depth) {
				const closed = stack.pop();
				if (closed) items.push({ row: closed, close: true });
			}
			visible.push(row);
			items.push({ row });
			if (isBranch(row)) {
				if (q ? ancestors.has(row.path) : open.has(row.path)) stack.push(row);
				else closedDepth = row.depth;
			}
		}
		while (stack.length) {
			const closed = stack.pop();
			if (closed) items.push({ row: closed, close: true });
		}
		return { visible, items };
	}, [rows, open, q, keep, ancestors]);

	const currentPath = matches.length
		? matches[Math.min(current, matches.length - 1)]
		: undefined;
	const focusPath = visible.some((r) => r.path === focused)
		? focused
		: visible[0]?.path;

	const toggle = (p: string, to?: boolean) =>
		setOpen((prev) => {
			const next = new Set(prev);
			if (to ?? !next.has(p)) next.add(p);
			else next.delete(p);
			return next;
		});
	const moveTo = (p: string) => {
		setFocused(p);
		requestAnimationFrame(() =>
			treeRef.current
				?.querySelector<HTMLElement>(`[data-path="${CSS.escape(p)}"]`)
				?.focus(),
		);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const i = visible.findIndex((r) => r.path === focusPath);
		const row = visible[i];
		if (!row) return;
		const go = (j: number) => {
			const r = visible[Math.max(0, Math.min(visible.length - 1, j))];
			if (r) moveTo(r.path);
		};
		switch (e.key) {
			case "ArrowDown":
				go(i + 1);
				break;
			case "ArrowUp":
				go(i - 1);
				break;
			case "Home":
				go(0);
				break;
			case "End":
				go(visible.length - 1);
				break;
			case "ArrowRight":
				if (isBranch(row) && !isOpen(row.path)) toggle(row.path, true);
				else if (isBranch(row)) go(i + 1);
				break;
			case "ArrowLeft":
				if (isBranch(row) && isOpen(row.path) && !q) toggle(row.path, false);
				else if (row.parent) moveTo(row.parent);
				break;
			case "Enter":
			case " ":
				if (e.repeat) break;
				if (isBranch(row) && !q) toggle(row.path);
				else if (row.kind === "string" && row.literal.length > FOLD_AT)
					setUnfolded((prev) => {
						const next = new Set(prev);
						if (next.has(row.path)) next.delete(row.path);
						else next.add(row.path);
						return next;
					});
				break;
			default:
				return;
		}
		e.preventDefault();
	};

	const step = (by: number) => {
		if (!matches.length) return;
		const next = (current + by + matches.length) % matches.length;
		setCurrent(next);
		requestAnimationFrame(() =>
			treeRef.current
				?.querySelector(`[data-path="${CSS.escape(matches[next])}"]`)
				?.scrollIntoView({ block: "nearest" }),
		);
	};

	const text = useMemo(() => JSON.stringify(data, null, 2), [data]);
	const focusRow = focusPath ? byPath.get(focusPath) : undefined;
	const focusJsonPath = focusRow ? pathOf(focusRow, byPath) : "$";
	const punct = "tone-content-secondary";

	return (
		<div
			data-slot="json-view"
			className={[
				"code-surface flex min-w-0 flex-col overflow-hidden rounded-overlay tone-content-primary",
				className,
			]
				.filter(Boolean)
				.join(" ")}
			{...props}
		>
			{(toolbar || copy) && (
				<div data-slot="json-view-toolbar" className="json-toolbar">
					{toolbar && (
						<label className="field json-search-field">
							<span className="tone-content-tertiary">
								<Glyph name="search" />
							</span>
							<input
								ref={searchRef}
								type="search"
								data-control=""
								aria-label={`Search ${label}`}
								value={query}
								onChange={(e) => {
									setQuery(e.target.value);
									setCurrent(0);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										step(e.shiftKey ? -1 : 1);
									}
									if (e.key === "Escape" && query) {
										e.preventDefault();
										setQuery("");
									}
								}}
								placeholder="Search keys and values"
								className="json-search-input"
							/>
							{q && (
								<span
									aria-live="polite"
									className="shrink-0 content-caption tone-content-secondary"
								>
									{matches.length
										? `${Math.min(current, matches.length - 1) + 1} of ${matches.length}`
										: "No matches"}
								</span>
							)}
							{query && (
								<button
									type="button"
									aria-label="Clear search"
									onClick={() => {
										setQuery("");
										searchRef.current?.focus();
									}}
									className="json-search-clear"
								>
									<Glyph name="clear" />
								</button>
							)}
						</label>
					)}
					{!toolbar && (
						<span className="json-search-caption content-caption tone-content-secondary">
							{label}
						</span>
					)}
					{toolbar && (
						<>
							<Button
								variant="ghost"
								size="small"
								ariaLabel="Open all"
								disabled={!!q}
								onAction={() =>
									setOpen(new Set(rows.filter(isBranch).map((r) => r.path)))
								}
							>
								<Glyph name="expand" />
							</Button>
							<Button
								variant="ghost"
								size="small"
								ariaLabel="Close all"
								disabled={!!q}
								onAction={() => setOpen(new Set())}
							>
								<Glyph name="collapse" />
							</Button>
						</>
					)}
					{copy && (
						<CopyButton
							text={text}
							label="JSON"
							showLabel={false}
							size="small"
							variant="ghost"
						/>
					)}
				</div>
			)}
			<section
				ref={bodyRef}
				data-slot="json-view-body"
				dir="ltr"
				tabIndex={bodyTab}
				aria-label={label}
				className="json-body focus-visible:focus-ring-inset"
			>
				{q && !matches.length ? (
					<p className="json-no-matches">
						Nothing matches{" "}
						<code className="tone-content-primary">{query.trim()}</code>
					</p>
				) : (
					<div
						ref={treeRef}
						role="tree"
						aria-label={label}
						className="json-tree"
					>
						{items.map(({ row, close }) => {
							if (close)
								return (
									<div
										key={`${row.path}/`}
										aria-hidden
										className={`json-closing-row ${punct}`}
										data-depth={row.depth}
									>
										{row.kind === "array" ? "]" : "}"}
										{!row.last && row.depth > 0 && ","}
									</div>
								);
							const branch = isBranch(row);
							const opened = branch && isOpen(row.path);
							const keyText =
								row.key === undefined
									? ""
									: row.key.kind === "index"
										? String(row.key.value)
										: JSON.stringify(row.key.value);
							const keyMarks =
								q && row.key !== undefined ? findAll(keyText, q) : undefined;
							const valueText = branch ? "" : row.literal;
							const valueMarks =
								q && !branch ? findAll(valueText, q) : undefined;
							const isCurrent = row.path === currentPath;
							const folded =
								row.kind === "string" &&
								valueText.length > FOLD_AT &&
								!unfolded.has(row.path) &&
								!q;
							return (
								<div
									key={row.path}
									role="treeitem"
									data-path={row.path}
									data-current={isCurrent || undefined}
									aria-level={row.depth + 1}
									aria-expanded={branch ? opened : undefined}
									aria-selected={row.path === focusPath}
									tabIndex={row.path === focusPath ? 0 : -1}
									onFocus={() => setFocused(row.path)}
									onKeyDown={onKeyDown}
									onPointerDown={(event) => {
										pressedFocused.current =
											document.activeElement === event.currentTarget;
									}}
									onClick={(event) => {
										// The caret always toggles. A click on a row first focuses it, so reading a branch's path does not fold
										// it; a second click on the focused branch toggles. The root folds only from its caret or the keyboard.
										const onCaret = (event.target as HTMLElement).closest(
											"[data-slot=json-view-caret]",
										);
										if (
											branch &&
											!q &&
											(onCaret || (pressedFocused.current && row.depth > 0))
										)
											toggle(row.path);
										pressedFocused.current = false;
										setFocused(row.path);
									}}
									data-slot="json-view-row"
									className={[
										"json-item-row",
										"transition-[background-color] duration-(--dur-state) ease-out hover:bg-hover focus-visible:focus-ring-inset",
										folded && "json-item-folded",
										branch && !q && "cursor-pointer",
										isCurrent && "json-item-current",
									]
										.filter(Boolean)
										.join(" ")}
									data-depth={row.depth}
								>
									<span
										aria-hidden
										data-slot="json-view-caret"
										className="relative inline-flex w-5 shrink-0 items-center justify-center self-stretch tone-content-secondary"
									>
										{branch && (
											<span
												className={[
													"transition-[rotate] duration-(--dur-state) ease-out",
													opened && "rotate-90",
												]
													.filter(Boolean)
													.join(" ")}
											>
												<Glyph name="caret" />
											</span>
										)}
									</span>
									{row.key !== undefined && (
										<>
											<span
												className={
													row.key.kind === "index"
														? "tone-content-secondary"
														: "tone-content-primary"
												}
											>
												<HighlightedText
													value={keyText}
													marks={keyMarks}
													current={isCurrent ? 0 : undefined}
												/>
											</span>
											<span className={punct}>: </span>
										</>
									)}
									{branch ? (
										<>
											<span className={punct}>
												{row.kind === "array" ? "[" : "{"}
											</span>
											{!opened && (
												<>
													<span className={punct}>
														…{row.kind === "array" ? "]" : "}"}
														{!row.last && row.depth > 0 && ","}
													</span>
													<span className="json-summary content-caption tone-content-secondary">
														{row.size}{" "}
														{row.kind === "array"
															? row.size === 1
																? "item"
																: "items"
															: row.size === 1
																? "key"
																: "keys"}
													</span>
												</>
											)}
										</>
									) : (
										<>
											{folded ? (
												<>
													<span className="min-w-0 truncate">
														{valueText.slice(0, FOLD_TO)}…
													</span>
													<button
														type="button"
														data-slot="json-view-unfold"
														tabIndex={-1}
														onClick={(event) => {
															event.stopPropagation();
															setUnfolded((prev) =>
																new Set(prev).add(row.path),
															);
														}}
														className="json-unfold"
													>
														+
														{(valueText.length - FOLD_TO).toLocaleString(
															"en-US",
														)}{" "}
														chars
													</button>
												</>
											) : (
												<HighlightedText
													value={valueText}
													marks={valueMarks}
													current={
														isCurrent && !keyMarks?.length ? 0 : undefined
													}
												/>
											)}
											{!row.last && row.depth > 0 && (
												<span className={punct}>,</span>
											)}
										</>
									)}
								</div>
							);
						})}
					</div>
				)}
			</section>
			{(path ?? toolbar) && (
				<div data-slot="json-view-path" className="json-path-row">
					<span className="content-caption tone-content-secondary">Path</span>
					<code
						dir="ltr"
						className="min-w-0 flex-1 truncate json-tree-type tone-content-primary"
					>
						{focusJsonPath}
					</code>
					<CopyButton
						text={focusJsonPath}
						label="path"
						showLabel={false}
						size="small"
						variant="ghost"
					/>
				</div>
			)}
		</div>
	);
}

export { JsonView, pathOf, type JsonViewProps };
