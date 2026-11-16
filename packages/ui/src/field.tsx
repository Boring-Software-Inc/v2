import type { ValidityKey } from "@ui-sdk/react/field";
import {
	Field as BehaviorField,
	FieldDescription as BehaviorFieldDescription,
	FieldError as BehaviorFieldError,
	FieldGroup as BehaviorFieldGroup,
	FieldLabel as BehaviorFieldLabel,
	FieldLegend as BehaviorFieldLegend,
	FieldSet as BehaviorFieldSet,
} from "@ui-sdk/react/field";
import {
	Input as BehaviorInput,
	InputGroup as BehaviorInputGroup,
} from "@ui-sdk/react/input";
import { Textarea as BehaviorTextarea } from "@ui-sdk/react/textarea";
import {
	type ChangeEventHandler,
	createContext,
	type FocusEventHandler,
	type KeyboardEventHandler,
	type ReactNode,
	type Ref,
	useContext,
} from "react";
import type { AccessibleName } from "./accessible-name";
import { CopyButton } from "./copy-button";
import { type InteractionDetails, interactionDetails } from "./interaction";
import { Kbd } from "./kbd";

export interface FieldProps {
	children: ReactNode;
	disabled?: boolean;
	invalid?: boolean;
	name?: string;
	orientation?: "horizontal" | "vertical";
}

const TripwireFieldContext = createContext<{ disabled: boolean } | null>(null);

export function Field({
	children,
	disabled,
	invalid,
	name,
	orientation = "vertical",
}: FieldProps) {
	return (
		<TripwireFieldContext.Provider value={{ disabled: disabled ?? false }}>
			<BehaviorField
				data-disabled={disabled ? "" : undefined}
				data-slot="field"
				data-orientation={orientation}
				disabled={disabled}
				invalid={invalid}
				name={name}
			>
				{children}
			</BehaviorField>
		</TripwireFieldContext.Provider>
	);
}

export interface FieldSetProps {
	children: ReactNode;
	description?: ReactNode;
	disabled?: boolean;
	legend: ReactNode;
	orientation?: "horizontal" | "vertical";
}

export function FieldSet({
	children,
	description,
	disabled,
	legend,
	orientation = "vertical",
}: FieldSetProps) {
	return (
		<BehaviorFieldSet
			data-orientation={orientation}
			data-slot="field-set"
			disabled={disabled}
		>
			<BehaviorFieldLegend data-slot="field-legend">
				{legend}
			</BehaviorFieldLegend>
			{description ? (
				<BehaviorFieldDescription data-slot="field-description">
					{description}
				</BehaviorFieldDescription>
			) : null}
			<BehaviorFieldGroup data-slot="field-group">
				{children}
			</BehaviorFieldGroup>
		</BehaviorFieldSet>
	);
}

export function FieldLabel({ children }: { children: ReactNode }) {
	return (
		<BehaviorFieldLabel data-slot="field-label">{children}</BehaviorFieldLabel>
	);
}

export function FieldDescription({ children }: { children: ReactNode }) {
	return (
		<BehaviorFieldDescription data-slot="field-description">
			{children}
		</BehaviorFieldDescription>
	);
}

export interface FieldErrorProps {
	children?: ReactNode;
	match?: boolean | ValidityKey;
}

export function FieldError({ children, match }: FieldErrorProps) {
	return (
		<BehaviorFieldError data-slot="field-error" match={match}>
			{children}
		</BehaviorFieldError>
	);
}

interface TextControlOptions {
	ariaDescribedBy?: string;
	autoFocus?: boolean;
	autoComplete?: string;
	disabled?: boolean;
	id?: string;
	invalid?: boolean;
	maxLength?: number;
	name?: string;
	onBlur?: FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
	onChange?: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
	onFocus?: FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
	onKeyDown?: KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement>;
	placeholder?: string;
	readOnly?: boolean;
	required?: boolean;
	onValueChange?: (value: string, details: InteractionDetails) => void;
}

type TextControlState =
	| { defaultValue?: string; value?: never }
	| { defaultValue?: never; value: string };

type TextControlName =
	| (AccessibleName & { labelledByField?: never })
	| {
			ariaLabel?: never;
			ariaLabelledBy?: never;
			labelledByField: true;
	  };

interface InputOptions extends TextControlOptions {
	ariaKeyShortcuts?: string;
	appearance?: "default" | "compact-search";
	copy?: {
		label?: string;
		value: string;
	};
	inputMode?:
		| "decimal"
		| "email"
		| "none"
		| "numeric"
		| "search"
		| "tel"
		| "text"
		| "url";
	leadingIcon?: ReactNode;
	max?: number | string;
	min?: number | string;
	pattern?: string;
	ref?: Ref<HTMLInputElement>;
	showShortcutHint?: boolean;
	type?: "date" | "email" | "number" | "password" | "search" | "text" | "url";
}

export type InputProps = InputOptions & TextControlState & TextControlName;

export function Input({
	appearance = "default",
	ariaKeyShortcuts,
	ariaLabel,
	ariaLabelledBy,
	ariaDescribedBy,
	autoFocus,
	autoComplete,
	copy,
	defaultValue,
	disabled: disabledProp,
	id,
	inputMode,
	invalid,
	labelledByField,
	leadingIcon,
	max,
	maxLength,
	min,
	name,
	onBlur,
	onChange,
	onFocus,
	onKeyDown,
	onValueChange,
	pattern,
	placeholder,
	readOnly,
	required,
	ref,
	showShortcutHint,
	type = "text",
	value,
}: InputProps) {
	const fieldContext = useContext(TripwireFieldContext);
	const disabled = disabledProp || fieldContext?.disabled;
	if (labelledByField && !fieldContext) {
		throw new Error("Input declared a Field label outside a Field");
	}
	const control = (
		<BehaviorInput
			aria-describedby={ariaDescribedBy}
			aria-invalid={invalid || undefined}
			aria-keyshortcuts={ariaKeyShortcuts}
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			autoFocus={autoFocus}
			autoComplete={autoComplete}
			data-slot="input"
			data-appearance={appearance}
			defaultValue={defaultValue}
			disabled={disabled || readOnly}
			id={id}
			inputMode={inputMode}
			max={max}
			maxLength={maxLength}
			min={min}
			name={name}
			onBlur={onBlur as FocusEventHandler<HTMLInputElement>}
			onChange={onChange as ChangeEventHandler<HTMLInputElement>}
			onFocus={onFocus as FocusEventHandler<HTMLInputElement>}
			onKeyDown={onKeyDown as KeyboardEventHandler<HTMLInputElement>}
			onValueChange={(nextValue, details) =>
				readOnly
					? details.cancel()
					: onValueChange?.(nextValue, interactionDetails(details))
			}
			pattern={pattern}
			placeholder={placeholder}
			readOnly={readOnly}
			ref={ref}
			render={
				<input
					data-disabled={disabled ? "" : null}
					disabled={disabled ?? false}
					readOnly={readOnly}
				/>
			}
			required={required}
			type={type}
			value={value}
		/>
	);
	const shortcutHint = showShortcutHint && ariaKeyShortcuts;
	if (!(leadingIcon || copy || shortcutHint)) {
		return control;
	}
	return (
		<BehaviorInputGroup data-appearance={appearance}>
			{leadingIcon ? (
				<span aria-hidden="true" data-slot="input-leading">
					{leadingIcon}
				</span>
			) : null}
			{control}
			{shortcutHint ? (
				<span aria-hidden="true" data-slot="input-shortcut-hint">
					<Kbd keyName={shortcutHint} />
				</span>
			) : null}
			{copy ? (
				<CopyButton
					ariaLabel={copy.label ?? "Copy value"}
					size="small"
					text={copy.value}
					variant="ghost"
				/>
			) : null}
		</BehaviorInputGroup>
	);
}

interface TextareaOptions extends TextControlOptions {
	ref?: Ref<HTMLTextAreaElement>;
	rows?: number;
}

export type TextareaProps = TextareaOptions &
	TextControlState &
	TextControlName;

export function Textarea({
	ariaLabel,
	ariaLabelledBy,
	ariaDescribedBy,
	autoFocus,
	autoComplete,
	defaultValue,
	disabled: disabledProp,
	id,
	invalid,
	labelledByField,
	maxLength,
	name,
	onBlur,
	onChange,
	onFocus,
	onKeyDown,
	onValueChange,
	placeholder,
	readOnly,
	required,
	ref,
	rows,
	value,
}: TextareaProps) {
	const fieldContext = useContext(TripwireFieldContext);
	const disabled = disabledProp || fieldContext?.disabled;
	if (labelledByField && !fieldContext) {
		throw new Error("Textarea declared a Field label outside a Field");
	}
	return (
		<BehaviorTextarea
			aria-describedby={ariaDescribedBy}
			aria-invalid={invalid || undefined}
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			autoFocus={autoFocus}
			autoComplete={autoComplete}
			data-slot="textarea"
			defaultValue={defaultValue}
			disabled={disabled || readOnly}
			id={id}
			maxLength={maxLength}
			name={name}
			onBlur={onBlur as FocusEventHandler<HTMLTextAreaElement>}
			onChange={onChange as ChangeEventHandler<HTMLTextAreaElement>}
			onFocus={onFocus as FocusEventHandler<HTMLTextAreaElement>}
			onKeyDown={onKeyDown as KeyboardEventHandler<HTMLTextAreaElement>}
			onValueChange={(nextValue, details) =>
				readOnly
					? details.cancel()
					: onValueChange?.(nextValue, interactionDetails(details))
			}
			placeholder={placeholder}
			readOnly={readOnly}
			ref={ref}
			render={
				<textarea
					data-disabled={disabled ? "" : null}
					disabled={disabled ?? false}
					readOnly={readOnly}
				/>
			}
			required={required}
			rows={rows}
			value={value}
		/>
	);
}
