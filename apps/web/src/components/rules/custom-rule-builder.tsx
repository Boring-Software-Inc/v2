import { useQuery } from "@tanstack/react-query";
import {
	CUSTOM_SIGNALS,
	type CustomRuleDefinition,
	type CustomSignalDisplay,
	customRuleSentence,
	valuePlaceholder,
	verbsForSignal,
} from "@tripwire/contracts";
import { type ReactNode, useMemo, useState } from "react";
import { Check, Icon } from "#/components/glaze/icon";
import { ComboboxField } from "#/components/glaze/ui/combobox";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/glaze/ui/command";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import { Field, FieldLabel } from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";
import { cn } from "#/lib/glaze/utils";
import { repoSuggestionsQueryOptions } from "#/lib/rules.query";

/**
 * The rule builder: a sentence with blanks, not a form. The rule reads as
 * plain language and is authored by completing it left to right; each blank
 * reveals the next. Each blank is an underlined word that opens its picker,
 * so the sentence wraps like text and never strands a word.
 */

const GROUPS: CustomSignalDisplay["group"][] = [
	"The account",
	"Their activity",
	"This repo",
	"This change",
	"The change request description",
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
	if (!state.signal || !comparison) {
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
				return "Enter a low and a high number.";
			}
			return percentRangeIssue(signal, min) ?? percentRangeIssue(signal, max);
		}
		if (value.trim().length === 0) {
			return null;
		}
		const parsed = Number(value.trim());
		if (!Number.isFinite(parsed)) {
			return "Enter a number.";
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
		? "Enter a percentage from 0 to 100."
		: null;
}

export function nextStep(state: BuilderState): string | null {
	if (!state.signal) {
		return "Pick what to check.";
	}
	if (state.signal.kind === "timestamps" && !state.window) {
		return "Pick a time window.";
	}
	if (!state.verb) {
		return "Pick a comparison.";
	}
	if (!parseValue(state)) {
		return isListVerb(state.verb.kind)
			? "Add at least one value."
			: (valueIssue(state) ?? "Enter a value.");
	}
	if (state.name.trim().length === 0) {
		return "Name the rule to save it.";
	}
	return null;
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

	const sentenceDraft = draftFromState({ ...state, name: state.name || "-" });
	const namePlaceholder = sentenceDraft
		? customRuleSentence(sentenceDraft.definition)
		: undefined;
	const verbLabel = state.verb?.label;
	const windowLabel = WINDOWS.find((w) => w.window === state.window)?.label;
	const listValue = state.values.join(", ");

	return (
		<Dialog onOpenChange={(next) => !next && onClose()} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create rule</DialogTitle>
				</DialogHeader>
				<DialogBody className="flex flex-col gap-4">
					<div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2 type-body text-text-1">
						<span>Require that</span>
						<SignalWord
							onPick={(signal) =>
								set({
									area: signal.group,
									signal,
									window: null,
									verb: null,
									...VALUE_RESET,
								})
							}
							signal={state.signal}
						/>
						{needsWindow ? (
							<>
								<span>in the last</span>
								<DropdownMenu>
									<DropdownMenuTrigger className={wordClass(!windowLabel)}>
										{windowLabel ?? "time window"}
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" size="sm">
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
								<DropdownMenuTrigger className={wordClass(!verbLabel)}>
									{verbLabel ?? "comparison"}
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" size="sm">
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
								<ValueWord empty={!listValue} label={listValue || "values"}>
									<ComboboxField
										aria-label="Values"
										className="w-full"
										creatable
										items={suggestions ?? []}
										multiple
										onValueChange={(next) =>
											set({ values: Array.isArray(next) ? next : [] })
										}
										placeholder={valuePlaceholder(
											state.signal,
											state.verb.kind,
										)}
										value={state.values}
									/>
								</ValueWord>
							) : state.verb.kind === "between" ? (
								<>
									<ValueWord empty={!state.value} label={state.value || "low"}>
										<Input
											aria-invalid={valueMessage !== null}
											aria-label="Low"
											autoFocus
											inputMode="numeric"
											max={isPercentSignal ? 100 : undefined}
											min={isPercentSignal ? 0 : undefined}
											onChange={(e) => set({ value: e.target.value })}
											placeholder="Low"
											type="number"
											value={state.value}
										/>
									</ValueWord>
									<span>and</span>
									<ValueWord empty={!state.high} label={state.high || "high"}>
										<Input
											aria-invalid={valueMessage !== null}
											aria-label="High"
											autoFocus
											inputMode="numeric"
											max={isPercentSignal ? 100 : undefined}
											min={isPercentSignal ? 0 : undefined}
											onChange={(e) => set({ high: e.target.value })}
											placeholder="High"
											type="number"
											value={state.high}
										/>
									</ValueWord>
								</>
							) : (
								<ValueWord
									empty={!state.value}
									label={
										state.value
											? `${state.value}${isPercentSignal ? "%" : ""}`
											: "value"
									}
								>
									<Input
										aria-invalid={valueMessage !== null}
										aria-label="Value"
										autoFocus
										inputMode={numericInput ? "numeric" : undefined}
										max={percentInput ? 100 : undefined}
										min={percentInput ? 0 : undefined}
										onChange={(e) => set({ value: e.target.value })}
										placeholder={valuePlaceholder(
											state.signal,
											state.verb.kind,
										)}
										type={numericInput ? "number" : "text"}
										value={state.value}
									/>
								</ValueWord>
							)
						) : null}
					</div>
					{valueMessage ? (
						<output className="type-body-sm text-fail-text">
							{valueMessage}
						</output>
					) : null}
					{state.verb ? (
						<Field>
							<FieldLabel>Rule name</FieldLabel>
							<Input
								maxLength={80}
								onChange={(e) => set({ name: e.target.value })}
								placeholder={namePlaceholder}
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

const DOWN = { side: "none", align: "shift" } as const;

function wordClass(empty: boolean): string {
	return cn(
		"-mx-1 rounded-tag px-1 type-body font-medium underline decoration-dotted decoration-line-strong underline-offset-4 transition-colors duration-(--dur-state) ease-out hover:bg-hover data-popup-open:bg-hover data-popup-open:no-underline",
		empty ? "bg-hover text-text-3 no-underline" : "text-text-1",
	);
}

function SignalWord({
	signal,
	onPick,
}: {
	signal: CustomSignalDisplay | null;
	onPick: (signal: CustomSignalDisplay) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger className={wordClass(!signal)}>
				{signal ? signal.label.toLowerCase() : "what to check"}
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="p-0"
				collisionAvoidance={DOWN}
				side="bottom"
			>
				<Command label="What to check" loop>
					<CommandInput autoFocus placeholder="Search" />
					<CommandList>
						<CommandEmpty />
						{GROUPS.map((group) => (
							<CommandGroup heading={group} key={group}>
								{CUSTOM_SIGNALS.filter((s) => s.group === group).map((s) => (
									<CommandItem
										key={s.id}
										onSelect={() => {
											onPick(s);
											setOpen(false);
										}}
										value={s.label}
									>
										{s.label}
										{s.id === signal?.id ? (
											<Icon className="ms-auto" icon={Check} />
										) : null}
									</CommandItem>
								))}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

function ValueWord({
	label,
	empty,
	children,
}: {
	label: string;
	empty: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger className={wordClass(empty)}>{label}</PopoverTrigger>
			<PopoverContent align="start" collisionAvoidance={DOWN} side="bottom">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						setOpen(false);
					}}
				>
					{children}
				</form>
			</PopoverContent>
		</Popover>
	);
}
