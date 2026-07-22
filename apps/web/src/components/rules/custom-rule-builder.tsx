import {
	CUSTOM_SIGNALS,
	type CustomRuleDefinition,
	type CustomSignalDisplay,
	customRuleSentence,
	VERBS_BY_KIND,
} from "@tripwire/contracts";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import { cn } from "#/lib/utils";

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

interface BuilderState {
	signal: CustomSignalDisplay | null;
	window: string | null;
	verb: { kind: string; label: string } | null;
	value: string;
	severity: (typeof SEVERITIES)[number] | null;
	name: string;
}

function windowHours(window: string): number {
	const count = Number.parseInt(window, 10);
	return window.endsWith("d") ? count * 24 : count;
}

function chipClass(filled: boolean): string {
	return cn(
		"rounded px-1.5 py-0.5 text-sm ring-1 transition-colors",
		filled
			? "bg-surface-1 ring-border hover:ring-primary/50"
			: "bg-surface-1 text-muted-foreground ring-border border-dashed hover:ring-primary/50",
	);
}

function parseValue(
	state: BuilderState,
): CustomRuleDefinition["comparison"] | null {
	const { signal, verb, value } = state;
	if (!signal || !verb) {
		return null;
	}
	if (signal.kind === "boolean") {
		return verb.kind === "not"
			? { kind: "not", args: [{ kind: "equals", args: [true] }] }
			: { kind: "equals", args: [true] };
	}
	if (signal.kind === "textList") {
		const globs = value
			.split(/[\n,]/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
		return globs.length > 0 ? { kind: "noneMatch", args: [globs] } : null;
	}
	if (signal.kind === "number" || signal.kind === "timestamps") {
		if (verb.kind === "between") {
			const [min, max] = value.split("-").map((entry) => Number(entry.trim()));
			return Number.isFinite(min) && Number.isFinite(max)
				? { kind: "between", args: [min as number, max as number] }
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
	if (verb.kind === "oneOf" || verb.kind === "noneOf") {
		const entries = value
			.split(/[\n,]/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
		return entries.length > 0
			? ({
					kind: verb.kind,
					args: [entries],
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

export interface CustomRuleBuilderProps {
	open: boolean;
	onClose: () => void;
	onSave: (draft: CustomRuleDraft) => Promise<string | null>;
}

export function CustomRuleBuilder({
	open,
	onClose,
	onSave,
}: CustomRuleBuilderProps) {
	const [state, setState] = useState<BuilderState>({
		signal: null,
		window: null,
		verb: null,
		value: "",
		severity: null,
		name: "",
	});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const draft = useMemo(() => draftFromState(state), [state]);
	const needsWindow = state.signal?.kind === "timestamps";
	const needsValue = state.signal !== null && state.signal.kind !== "boolean";
	const verbs = state.signal ? VERBS_BY_KIND[state.signal.kind] : [];

	const set = (patch: Partial<BuilderState>) =>
		setState((prev) => ({ ...prev, ...patch }));

	const save = async () => {
		if (!draft) {
			return;
		}
		setSaving(true);
		setError(null);
		const failure = await onSave(draft);
		setSaving(false);
		if (failure) {
			setError(failure);
			return;
		}
		setState({
			signal: null,
			window: null,
			verb: null,
			value: "",
			severity: null,
			name: "",
		});
		onClose();
	};

	return (
		<Dialog onOpenChange={(next) => !next && onClose()} open={open}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>create rule</DialogTitle>
					<DialogDescription>
						complete the sentence. it becomes the rule.
					</DialogDescription>
				</DialogHeader>
				<div className="px-5 pb-4">
					<div className="flex flex-wrap items-center gap-1.5 text-sm leading-8">
						<span>Flag when</span>
						<DropdownMenu>
							<DropdownMenuTrigger className={chipClass(state.signal !== null)}>
								{state.signal?.label ?? "pick a signal"}
							</DropdownMenuTrigger>
							<DropdownMenuContent className="max-h-80 overflow-y-auto">
								{GROUPS.map((group, index) => (
									<div key={group}>
										{index > 0 ? <DropdownMenuSeparator /> : null}
										<DropdownMenuLabel className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
											{group}
										</DropdownMenuLabel>
										{CUSTOM_SIGNALS.filter((s) => s.group === group).map(
											(signal) => (
												<DropdownMenuItem
													key={signal.id}
													onClick={() =>
														set({
															signal,
															window: null,
															verb: null,
															value: "",
														})
													}
												>
													{signal.label}
												</DropdownMenuItem>
											),
										)}
									</div>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
						{needsWindow ? (
							<>
								<span>in the last</span>
								<DropdownMenu>
									<DropdownMenuTrigger
										className={chipClass(state.window !== null)}
									>
										{WINDOWS.find((w) => w.window === state.window)?.label ??
											"pick a window"}
									</DropdownMenuTrigger>
									<DropdownMenuContent>
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
								<DropdownMenuTrigger className={chipClass(state.verb !== null)}>
									{state.verb?.label ?? "pick a comparison"}
								</DropdownMenuTrigger>
								<DropdownMenuContent>
									{verbs.map((verb) => (
										<DropdownMenuItem
											key={verb.kind + verb.label}
											onClick={() => set({ verb })}
										>
											{verb.label}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
						{state.verb && needsValue ? (
							<Input
								className="h-7 w-36 text-sm"
								onChange={(e) => set({ value: e.target.value })}
								placeholder={
									state.signal?.kind === "textList"
										? "globs, comma separated"
										: state.verb.kind === "between"
											? "min - max"
											: state.signal?.kind === "text" &&
													(state.verb.kind === "oneOf" ||
														state.verb.kind === "noneOf")
												? "values, comma separated"
												: "value"
								}
								value={state.value}
							/>
						) : null}
						{state.verb ? (
							<>
								<span>, as a</span>
								<DropdownMenu>
									<DropdownMenuTrigger
										className={chipClass(state.severity !== null)}
									>
										{state.severity ?? "pick a severity"}
									</DropdownMenuTrigger>
									<DropdownMenuContent>
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
						<p className="text-muted-foreground text-xs">
							{customRuleSentence(draft.definition)}
						</p>
					) : null}
					{state.severity ? (
						<Input
							className="mt-2"
							onChange={(e) => set({ name: e.target.value })}
							placeholder="name this rule"
							value={state.name}
						/>
					) : null}
					{error ? <p className="mt-2 text-red-500 text-xs">{error}</p> : null}
				</div>
				<DialogFooter>
					<DialogClose
						className="text-muted-foreground text-xs transition-colors hover:text-foreground"
						type="button"
					>
						cancel
					</DialogClose>
					<Button disabled={!draft || saving} onClick={save} size="sm">
						{saving ? "saving…" : "save rule"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
