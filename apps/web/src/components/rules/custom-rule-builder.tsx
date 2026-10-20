import { useQuery } from "@tanstack/react-query";
import {
	CUSTOM_SIGNALS,
	type CustomRuleDefinition,
	type CustomSignalDisplay,
	customRuleSentence,
	valuePlaceholder,
	verbsForSignal,
} from "@tripwire/contracts";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { ComboboxField } from "#/components/glaze/ui/combobox";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import { Field, FieldLabel } from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import { repoSuggestionsQueryOptions } from "#/lib/rules.query";

/**
 * The rule builder: a sentence with blanks, not a form. The rule reads as
 * plain language and is authored by completing it left to right; each blank
 * reveals the next. This is the rule card's read-state sentence made
 * editable, so the chip styling derives from the card's param chips.
 */

const GROUPS: CustomSignalDisplay["group"][] = [
	"The account",
	"Their activity",
	"This repo",
	"This change",
	"The PR description",
	"The commits",
	"The comment",
];

const WINDOWS = [
	{ window: "1h", label: "1 hour" },
	{ window: "6h", label: "6 hours" },
	{ window: "24h", label: "24 hours" },
	{ window: "7d", label: "7 days" },
	{ window: "30d", label: "30 days" },
] as const;

const SEVERITIES = ["low", "medium", "high"] as const;

export interface CustomRuleDraft {
	id?: string;
	name: string;
	definition: CustomRuleDefinition;
}

export interface BuilderState {
	area: CustomSignalDisplay["group"] | null;
	signal: CustomSignalDisplay | null;
	window: string | null;
	verb: { kind: string; label: string } | null;
	/** Scalar value, and the low end of a between range. */
	value: string;
	/** The high end of a between range. */
	high: string;
	/** Committed chips for a list verb. */
	values: string[];
	severity: (typeof SEVERITIES)[number] | null;
	name: string;
}

const EMPTY_STATE: BuilderState = {
	area: null,
	signal: null,
	window: null,
	verb: null,
	value: "",
	high: "",
	values: [],
	severity: null,
	name: "",
};

/** Clears every value field, for when the signal or verb changes underneath. */
const VALUE_RESET: Pick<BuilderState, "value" | "high" | "values"> = {
	value: "",
	high: "",
	values: [],
};

const LIST_VERBS = new Set([
	"oneOf",
	"noneOf",
	"containsAny",
	"anyIn",
	"noneMatch",
]);

function isListVerb(verbKind: string): boolean {
	return LIST_VERBS.has(verbKind);
}

function windowHours(window: string): number {
	const count = Number.parseInt(window, 10);
	return window.endsWith("d") ? count * 24 : count;
}

const BLANK = <Button size="sm" variant="secondary" />;

function parseValue(
	state: BuilderState,
): CustomRuleDefinition["comparison"] | null {
	const { signal, verb, value, high, values } = state;
	if (!signal || !verb) {
		return null;
	}
	if (signal.kind === "boolean") {
		return verb.kind === "not"
			? { kind: "not", args: [{ kind: "equals", args: [true] }] }
			: { kind: "equals", args: [true] };
	}
	if (isListVerb(verb.kind)) {
		return values.length > 0
			? ({
					kind: verb.kind,
					args: [values],
				} as CustomRuleDefinition["comparison"])
			: null;
	}
	if (signal.kind === "number" || signal.kind === "timestamps") {
		if (verb.kind === "between") {
			const min = Number(value.trim());
			const max = Number(high.trim());
			return Number.isFinite(min) && Number.isFinite(max)
				? { kind: "between", args: [min, max] }
				: null;
		}
		const parsed = Number(value.trim());
		return Number.isFinite(parsed)
			? ({
					kind: verb.kind,
					args: [parsed],
				} as CustomRuleDefinition["comparison"])
			: null;
	}
	return value.trim().length > 0
		? ({
				kind: verb.kind,
				args: [value.trim()],
			} as CustomRuleDefinition["comparison"])
		: null;
}

function draftFromState(state: BuilderState): CustomRuleDraft | null {
	const comparison = parseValue(state);
	if (!state.signal || !comparison || !state.severity) {
		return null;
	}
	if (state.name.trim().length === 0) {
		return null;
	}
	const needsWindow = state.signal.kind === "timestamps";
	if (needsWindow && !state.window) {
		return null;
	}
	return {
		name: state.name.trim(),
		definition: {
			when: {
				id: state.signal.id,
				...(needsWindow && state.window
					? { transform: { kind: "lastCount", window: state.window } }
					: {}),
			},
			comparison,
			severity: state.severity,
		} as CustomRuleDefinition,
	};
}

/**
 * Why the current value is invalid, in plain words, or null when it is empty
 * (incomplete, not wrong) or fine. This is what tells a maintainer why Save is
 * disabled instead of the button just sitting dead. List verbs use chips, which
 * can only be empty (incomplete), so they carry no message. The server
 * re-validates.
 */
export function valueIssue(state: BuilderState): string | null {
	const { signal, verb, value, high } = state;
	if (!signal || !verb || signal.kind === "boolean" || isListVerb(verb.kind)) {
		return null;
	}
	if (signal.kind === "number" || signal.kind === "timestamps") {
		if (verb.kind === "between") {
			if (value.trim().length === 0 || high.trim().length === 0) {
				return null;
			}
			const min = Number(value.trim());
			const max = Number(high.trim());
			if (!(Number.isFinite(min) && Number.isFinite(max))) {
				return "enter a low and a high number";
			}
			return percentRangeIssue(signal, min) ?? percentRangeIssue(signal, max);
		}
		if (value.trim().length === 0) {
			return null;
		}
		const parsed = Number(value.trim());
		if (!Number.isFinite(parsed)) {
			return "enter a number";
		}
		return percentRangeIssue(signal, parsed);
	}
	return null;
}

function percentRangeIssue(
	signal: CustomSignalDisplay,
	n: number,
): string | null {
	return signal.unit === "%" && (n < 0 || n > 100)
		? "enter a percentage from 0 to 100"
		: null;
}

export interface CustomRuleBuilderProps {
	open: boolean;
	onClose: () => void;
	onSave: (draft: CustomRuleDraft) => Promise<string | null>;
	org: string;
	repoId: string;
}

export function CustomRuleBuilder({
	open,
	onClose,
	onSave,
	org,
	repoId,
}: CustomRuleBuilderProps) {
	const [state, setState] = useState<BuilderState>(EMPTY_STATE);

	const draft = useMemo(() => draftFromState(state), [state]);
	const needsWindow = state.signal?.kind === "timestamps";
	const needsValue = state.signal !== null && state.signal.kind !== "boolean";
	const verbs = state.signal ? verbsForSignal(state.signal) : [];
	const valueMessage = valueIssue(state);
	const isPercentSignal = state.signal?.unit === "%";
	// Real repo values for enum-ish signals, cached behind the forge. An empty
	// result (no suggester, or not refreshed yet) just leaves free-text entry.
	const { data: suggestions } = useQuery(
		repoSuggestionsQueryOptions(org, repoId, state.signal?.suggests ?? ""),
	);
	const numericInput =
		(state.signal?.kind === "number" || state.signal?.kind === "timestamps") &&
		state.verb !== null &&
		state.verb.kind !== "between";
	const percentInput = numericInput && isPercentSignal;

	const set = (patch: Partial<BuilderState>) =>
		setState((prev) => ({ ...prev, ...patch }));

	const save = async () => {
		if (!draft) {
			return;
		}
		const failure = await onSave(draft);
		if (failure) {
			throw new Error(failure);
		}
		setState(EMPTY_STATE);
	};

	return (
		<Dialog onOpenChange={(next) => !next && onClose()} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create rule</DialogTitle>
					<DialogDescription>
						Complete the sentence. It becomes the rule.
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center gap-2 type-body text-text-1">
						<span>Require that</span>
						{state.signal === null ? (
							<DropdownMenu>
								<DropdownMenuTrigger render={BLANK}>
									{state.area ?? "Pick an area"}
									<Icon icon={ChevronDown} />
								</DropdownMenuTrigger>
								<DropdownMenuContent size="sm">
									{GROUPS.map((group) => (
										<DropdownMenuItem
											key={group}
											onClick={() =>
												set({
													area: group,
													signal: null,
													window: null,
													verb: null,
													...VALUE_RESET,
												})
											}
										>
											{group}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
						{state.area ? (
							<DropdownMenu>
								<DropdownMenuTrigger render={BLANK}>
									{state.signal?.label ?? "Pick a signal"}
									<Icon icon={ChevronDown} />
								</DropdownMenuTrigger>
								<DropdownMenuContent size="sm">
									<DropdownMenuItem
										onClick={() =>
											set({
												area: null,
												signal: null,
												window: null,
												verb: null,
												...VALUE_RESET,
											})
										}
									>
										<Icon icon={ArrowLeft} />
										Back to areas
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									{CUSTOM_SIGNALS.filter((s) => s.group === state.area).map(
										(signal) => (
											<DropdownMenuItem
												key={signal.id}
												onClick={() =>
													set({
														signal,
														window: null,
														verb: null,
														...VALUE_RESET,
													})
												}
											>
												{signal.label}
											</DropdownMenuItem>
										),
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
						{needsWindow ? (
							<>
								<span>in the last</span>
								<DropdownMenu>
									<DropdownMenuTrigger render={BLANK}>
										{WINDOWS.find((w) => w.window === state.window)?.label ??
											"Pick a window"}
										<Icon icon={ChevronDown} />
									</DropdownMenuTrigger>
									<DropdownMenuContent size="sm">
										{WINDOWS.filter(
											(w) =>
												!state.signal?.maxWindowHours ||
												windowHours(w.window) <= state.signal.maxWindowHours,
										).map((w) => (
											<DropdownMenuItem
												key={w.window}
												onClick={() => set({ window: w.window })}
											>
												{w.label}
											</DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
							</>
						) : null}
						{state.signal && (!needsWindow || state.window) ? (
							<DropdownMenu>
								<DropdownMenuTrigger render={BLANK}>
									{state.verb?.label ?? "Pick a comparison"}
									<Icon icon={ChevronDown} />
								</DropdownMenuTrigger>
								<DropdownMenuContent size="sm">
									{verbs.map((verb) => (
										<DropdownMenuItem
											key={verb.kind + verb.label}
											onClick={() => set({ verb, ...VALUE_RESET })}
										>
											{verb.label}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
						{state.verb && needsValue && state.signal ? (
							isListVerb(state.verb.kind) ? (
								<ComboboxField
									aria-label="Values"
									className="w-full"
									creatable
									items={suggestions ?? []}
									multiple
									onValueChange={(next) =>
										set({ values: Array.isArray(next) ? next : [] })
									}
									placeholder={valuePlaceholder(state.signal, state.verb.kind)}
									value={state.values}
								/>
							) : state.verb.kind === "between" ? (
								<>
									<Input
										aria-invalid={valueMessage !== null}
										aria-label="Low"
										className="w-20"
										inputMode="numeric"
										max={isPercentSignal ? 100 : undefined}
										min={isPercentSignal ? 0 : undefined}
										onChange={(e) => set({ value: e.target.value })}
										placeholder="Low"
										size="sm"
										type="number"
										value={state.value}
									/>
									<span>and</span>
									<Input
										aria-invalid={valueMessage !== null}
										aria-label="High"
										className="w-20"
										inputMode="numeric"
										max={isPercentSignal ? 100 : undefined}
										min={isPercentSignal ? 0 : undefined}
										onChange={(e) => set({ high: e.target.value })}
										placeholder="High"
										size="sm"
										type="number"
										value={state.high}
									/>
								</>
							) : (
								<Input
									aria-invalid={valueMessage !== null}
									aria-label="Value"
									className="w-36"
									inputMode={numericInput ? "numeric" : undefined}
									max={percentInput ? 100 : undefined}
									min={percentInput ? 0 : undefined}
									onChange={(e) => set({ value: e.target.value })}
									placeholder={valuePlaceholder(state.signal, state.verb.kind)}
									size="sm"
									type={numericInput ? "number" : "text"}
									value={state.value}
								/>
							)
						) : null}
						{state.verb ? (
							<>
								<span>, as a</span>
								<DropdownMenu>
									<DropdownMenuTrigger render={BLANK}>
										{state.severity ?? "Pick a severity"}
										<Icon icon={ChevronDown} />
									</DropdownMenuTrigger>
									<DropdownMenuContent size="sm">
										{SEVERITIES.map((severity) => (
											<DropdownMenuItem
												key={severity}
												onClick={() => set({ severity })}
											>
												{severity}
											</DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
								<span>signal.</span>
							</>
						) : null}
					</div>
					{draft ? (
						<p className="type-body-sm text-text-2">
							{customRuleSentence(draft.definition)}
						</p>
					) : null}
					{valueMessage ? (
						<output className="type-body-sm text-warn-text">
							{valueMessage}
						</output>
					) : null}
					{state.severity ? (
						<Field>
							<FieldLabel>Rule name</FieldLabel>
							<Input
								onChange={(e) => set({ name: e.target.value })}
								placeholder="Name this rule"
								value={state.name}
							/>
						</Field>
					) : null}
				</DialogBody>
				<DialogFooter>
					<DialogClose>Cancel</DialogClose>
					<DialogAction disabled={!draft} onAction={save} pendingLabel="Saving">
						Save rule
					</DialogAction>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
