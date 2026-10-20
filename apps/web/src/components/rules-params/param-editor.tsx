import type { RuleParam } from "@tripwire/contracts";
import { useRef, useState } from "react";
import { Checkbox } from "#/components/glaze/ui/checkbox";
import { Chip, ChipGroup } from "#/components/glaze/ui/chip";
import { Input } from "#/components/glaze/ui/input";
import { NativeSelect } from "#/components/glaze/ui/select";
import { coerceParamInput } from "./coerce";

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
			<Checkbox
				aria-label={param.label}
				checked={value === true}
				className="align-middle"
				onCheckedChange={(checked) => onSave(checked)}
			/>
		);
	}
	if (param.kind === "enum") {
		return (
			<NativeSelect
				aria-label={param.label}
				className="inline-block w-auto align-middle"
				defaultValue={typeof value === "string" ? value : param.default}
				onBlur={onCancel}
				onChange={(e) => onSave(e.target.value)}
				size="sm"
			>
				{param.options.map((opt) => (
					<option key={opt} value={opt}>
						{opt}
					</option>
				))}
			</NativeSelect>
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

	const suffix =
		param.kind === "number" && param.percent
			? "%"
			: param.kind === "number" && param.unit
				? param.unit
				: undefined;

	return (
		<span className="inline-flex flex-wrap items-center gap-1 align-middle">
			<Input
				aria-invalid={error !== null}
				aria-label={param.label}
				className={param.kind === "number" ? "w-28" : "w-40"}
				max={
					param.kind === "number" && param.max !== undefined
						? param.percent
							? param.max * 100
							: param.max
						: undefined
				}
				min={
					param.kind === "number" && param.min !== undefined
						? param.percent
							? param.min * 100
							: param.min
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
				size="sm"
				step={param.kind === "number" && param.int ? 1 : "any"}
				trailing={suffix}
				type={param.kind === "number" ? "number" : "text"}
				value={raw}
			/>
			{error ? (
				<span className="type-caption text-fail-text" role="alert">
					{error}
				</span>
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
	const inputRef = useRef<HTMLInputElement>(null);
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
			<ChipGroup aria-label={param.label}>
				{items.map((item) => (
					<Chip
						focusAfterEmpty={inputRef}
						key={item}
						onRemove={() => remove(item)}
						removeLabel={`Remove ${item}`}
					>
						{item}
					</Chip>
				))}
			</ChipGroup>
			<Input
				aria-label={`Add ${param.label}`}
				className="w-40"
				mono
				onBlur={add}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						add();
					}
				}}
				placeholder="Add path"
				ref={inputRef}
				size="sm"
				value={draft}
			/>
		</span>
	);
}
