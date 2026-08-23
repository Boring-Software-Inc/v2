import type { RuleParam } from "@tripwire/contracts";
import { useState } from "react";
import { coerceParamInput } from "./coerce";

const INPUT =
	"rounded border bg-background px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring";

/**
 * Schema-driven inline editor for ONE param (§9). Number/string/enum edit in
 * place (commit on enter/blur, escape cancels, out-of-range shows inline via
 * `coerceParamInput`); string-list edits as add/remove chips; boolean as a
 * toggle. No freeform JSON. `onSave` hands the card a typed value it merges into
 * the config and sends through the existing (admin-gated) mutation.
 */
export function ParamEditor({
	param,
	value,
	onSave,
	onCancel,
}: {
	param: RuleParam;
	value: unknown;
	onSave: (value: unknown) => void;
	onCancel: () => void;
}) {
	if (param.kind === "string-list") {
		return <StringListEditor onSave={onSave} param={param} value={value} />;
	}
	if (param.kind === "boolean") {
		return (
			<input
				aria-label={param.label}
				checked={value === true}
				className="accent-brand align-middle"
				onChange={(e) => onSave(e.target.checked)}
				type="checkbox"
			/>
		);
	}
	if (param.kind === "enum") {
		return (
			<select
				aria-label={param.label}
				className={INPUT}
				defaultValue={typeof value === "string" ? value : param.default}
				onBlur={onCancel}
				onChange={(e) => onSave(e.target.value)}
			>
				{param.options.map((opt) => (
					<option key={opt} value={opt}>
						{opt}
					</option>
				))}
			</select>
		);
	}
	return (
		<ScalarEditor
			onCancel={onCancel}
			onSave={onSave}
			param={param}
			value={value}
		/>
	);
}

function ScalarEditor({
	param,
	value,
	onSave,
	onCancel,
}: {
	param: Extract<RuleParam, { kind: "number" | "string" }>;
	value: unknown;
	onSave: (value: unknown) => void;
	onCancel: () => void;
}) {
	const initial =
		param.kind === "number"
			? String(
					param.percent
						? Math.round(
								(typeof value === "number" ? value : param.default) * 100,
							)
						: typeof value === "number"
							? value
							: param.default,
				)
			: typeof value === "string"
				? value
				: (param.default ?? "");
	const [raw, setRaw] = useState(initial);
	const [error, setError] = useState<string | null>(null);

	const commit = () => {
		const result = coerceParamInput(param, raw);
		if (result.ok) {
			onSave(result.value);
		} else {
			setError(result.error);
		}
	};

	return (
		<span className="inline-flex items-center gap-1 align-middle">
			<input
				aria-label={param.label}
				className={`w-16 ${INPUT}`}
				min={
					param.kind === "number" && param.min !== undefined
						? param.percent
							? param.min * 100
							: param.min
						: undefined
				}
				max={
					param.kind === "number" && param.max !== undefined
						? param.percent
							? param.max * 100
							: param.max
						: undefined
				}
				onBlur={commit}
				onChange={(e) => {
					setRaw(e.target.value);
					setError(null);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						commit();
					} else if (e.key === "Escape") {
						onCancel();
					}
				}}
				step={param.kind === "number" && param.int ? 1 : "any"}
				type={param.kind === "number" ? "number" : "text"}
				value={raw}
			/>
			{param.kind === "number" && param.percent ? (
				<span className="text-muted-foreground text-xs">%</span>
			) : param.kind === "number" && param.unit ? (
				<span className="text-muted-foreground text-xs">{param.unit}</span>
			) : null}
			{error ? (
				<span className="text-[11px] text-destructive">{error}</span>
			) : null}
		</span>
	);
}

function StringListEditor({
	param,
	value,
	onSave,
}: {
	param: Extract<RuleParam, { kind: "string-list" }>;
	value: unknown;
	onSave: (value: unknown) => void;
}) {
	const items = Array.isArray(value) ? (value as string[]) : [...param.default];
	const [draft, setDraft] = useState("");
	const remove = (item: string) => onSave(items.filter((i) => i !== item));
	const add = () => {
		const next = draft.trim();
		if (next.length > 0 && !items.includes(next)) {
			onSave([...items, next]);
		}
		setDraft("");
	};
	return (
		<span className="inline-flex flex-wrap items-center gap-1 align-middle">
			{items.map((item) => (
				<code
					className="inline-flex items-center gap-1 rounded bg-surface-1 px-1 py-0.5 font-mono text-[11px]"
					key={item}
				>
					{item}
					<button
						aria-label={`remove ${item}`}
						className="text-muted-foreground hover:text-destructive"
						onClick={() => remove(item)}
						type="button"
					>
						×
					</button>
				</code>
			))}
			<input
				aria-label={`add ${param.label}`}
				className={`w-28 ${INPUT} font-mono`}
				onBlur={add}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						add();
					}
				}}
				placeholder="add path…"
				value={draft}
			/>
		</span>
	);
}
