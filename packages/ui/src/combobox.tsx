import { Button as BehaviorButton } from "@ui-sdk/react/button";
import {
	Combobox as BehaviorCombobox,
	ComboboxChip,
	ComboboxChipRemove,
	ComboboxChips,
	ComboboxContent,
	ComboboxCreate,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxItemIcon,
	ComboboxItemIndicator,
	ComboboxItemText,
	ComboboxList,
	ComboboxTrigger,
	ComboboxValue,
} from "@ui-sdk/react/combobox";
import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	type Ref,
	useRef,
} from "react";
import type { AccessibleName } from "./accessible-name";
import { ChevronDown, Icon } from "./icon";
import {
	type InteractionDetails,
	interactionDetails,
	interactionFromEvent,
} from "./interaction";

export interface ComboboxOption<Value = string> {
	description?: string;
	disabled?: boolean;
	icon?: ReactNode;
	id?: string;
	label: string;
	value: Value;
}

interface ComboboxSharedProps<Value> {
	allowCustomValue?: boolean;
	autoFocus?: boolean;
	createLabel?: (query: string) => ReactNode;
	disabled?: boolean;
	emptyLabel?: string;
	form?: string;
	inputRef?: Ref<HTMLInputElement>;
	isItemEqualToValue?: (itemValue: Value, value: Value) => boolean;
	itemToLabel?: (value: Value) => string;
	itemToValue?: (value: Value) => string;
	name?: string;
	onCreate?: (query: string, details: InteractionDetails) => unknown;
	onOpenChange?: (open: boolean, details: InteractionDetails) => void;
	onQueryChange?: (query: string, details: InteractionDetails) => void;
	options: readonly ComboboxOption<Value>[];
	placeholder?: string;
	readOnly?: boolean;
	required?: boolean;
	valueTone?: (value: Value) => "default" | "warning";
	variant?: "default" | "inline";
}

type ComboboxOpenState =
	| { defaultOpen?: boolean; open?: never }
	| { defaultOpen?: never; open: boolean };

type ComboboxQueryState =
	| { defaultQuery?: string; query?: never }
	| { defaultQuery?: never; query: string };

type SingleComboboxValueState<Value> =
	| { defaultValue?: Value | null; value?: never }
	| { defaultValue?: never; value: Value | null };

type MultipleComboboxValueState<Value> =
	| { defaultValue?: Value[]; value?: never }
	| { defaultValue?: never; value: Value[] };

export type SingleComboboxProps<Value = string> = ComboboxSharedProps<Value> &
	AccessibleName &
	ComboboxOpenState &
	ComboboxQueryState &
	SingleComboboxValueState<Value> & {
		disclosureLabel?: string;
		multiple?: false;
		onValueChange?: (value: Value | null, details: InteractionDetails) => void;
	};

export type MultipleComboboxProps<Value = string> = ComboboxSharedProps<Value> &
	AccessibleName &
	ComboboxOpenState &
	ComboboxQueryState &
	MultipleComboboxValueState<Value> & {
		disclosureLabel?: never;
		multiple: true;
		onValueChange?: (value: Value[], details: InteractionDetails) => void;
	};

export type ComboboxProps<Value = string> =
	| SingleComboboxProps<Value>
	| MultipleComboboxProps<Value>;

export function Combobox<Value = string>(props: ComboboxProps<Value>) {
	const resolveValue = (value: Value) => {
		if (!props.itemToValue) {
			return value;
		}
		return (
			props.options.find(
				(option) => props.itemToValue?.(option.value) === value,
			)?.value ?? value
		);
	};
	const shared = {
		ariaLabel: props.ariaLabel,
		ariaLabelledBy: props.ariaLabelledBy,
		autoFocus: props.autoFocus,
		createLabel: props.createLabel,
		emptyLabel: props.emptyLabel ?? "No results",
		inputRef: props.inputRef,
		isItemEqualToValue: props.isItemEqualToValue,
		itemToValue: props.itemToValue,
		onCreate: props.onCreate,
		options: props.options,
		placeholder: props.placeholder,
		valueTone: props.valueTone,
		variant: props.variant ?? "default",
	};

	if (props.multiple) {
		return (
			<BehaviorCombobox<Value, true>
				allowCustomValue={props.allowCustomValue}
				defaultValue={props.defaultValue}
				defaultOpen={props.defaultOpen}
				defaultQuery={props.defaultQuery}
				disabled={props.disabled}
				form={props.form}
				isItemEqualToValue={props.isItemEqualToValue}
				itemToLabel={props.itemToLabel}
				itemToValue={props.itemToValue}
				multiple
				name={props.name}
				onOpenChange={(open, details) =>
					props.onOpenChange?.(open, interactionDetails(details))
				}
				onQueryChange={(query, details) =>
					props.onQueryChange?.(query, interactionDetails(details))
				}
				onValueChange={(nextValue, details) =>
					props.onValueChange?.(
						nextValue.map(resolveValue),
						interactionDetails(details),
					)
				}
				value={props.value}
				open={props.open}
				query={props.query}
				readOnly={props.readOnly}
				required={props.required}
			>
				<ComboboxFrame {...shared} multiple />
			</BehaviorCombobox>
		);
	}

	return (
		<BehaviorCombobox<Value>
			allowCustomValue={props.allowCustomValue}
			defaultValue={props.defaultValue}
			defaultOpen={props.defaultOpen}
			defaultQuery={props.defaultQuery}
			disabled={props.disabled}
			form={props.form}
			isItemEqualToValue={props.isItemEqualToValue}
			itemToLabel={props.itemToLabel}
			itemToValue={props.itemToValue}
			name={props.name}
			onOpenChange={(open, details) =>
				props.onOpenChange?.(open, interactionDetails(details))
			}
			onQueryChange={(query, details) =>
				props.onQueryChange?.(query, interactionDetails(details))
			}
			onValueChange={(nextValue, details) =>
				props.onValueChange?.(
					nextValue === null ? null : resolveValue(nextValue),
					interactionDetails(details),
				)
			}
			value={props.value}
			open={props.open}
			query={props.query}
			readOnly={props.readOnly}
			required={props.required}
		>
			<ComboboxFrame
				{...shared}
				disclosureLabel={props.disclosureLabel}
				multiple={false}
				readOnly={props.readOnly}
			/>
		</BehaviorCombobox>
	);
}

interface ComboboxFrameProps<Value> {
	ariaLabel?: string;
	ariaLabelledBy?: string;
	autoFocus?: boolean;
	createLabel?: (query: string) => ReactNode;
	disclosureLabel?: string;
	emptyLabel: string;
	inputRef?: Ref<HTMLInputElement>;
	isItemEqualToValue?: (itemValue: Value, value: Value) => boolean;
	itemToValue?: (value: Value) => string;
	multiple: boolean;
	onCreate?: (query: string, details: InteractionDetails) => unknown;
	options: readonly ComboboxOption<Value>[];
	placeholder?: string;
	readOnly?: boolean;
	valueTone?: (value: Value) => "default" | "warning";
	variant: "default" | "inline";
}

function ComboboxFrame<Value>({
	ariaLabel,
	ariaLabelledBy,
	autoFocus,
	createLabel,
	disclosureLabel,
	emptyLabel,
	inputRef,
	isItemEqualToValue,
	itemToValue,
	multiple,
	onCreate,
	options,
	placeholder,
	readOnly,
	valueTone,
	variant,
}: ComboboxFrameProps<Value>) {
	const createSource = useRef<InteractionDetails["source"]>("agent");
	const captureCreateSource = (
		event: KeyboardEvent<HTMLElement> | PointerEvent<HTMLElement>,
	) => {
		createSource.current = interactionFromEvent(event.nativeEvent).source;
	};
	const input = (
		<ComboboxInput
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			autoFocus={autoFocus}
			data-slot="combobox-input"
			onKeyDown={captureCreateSource}
			onPointerDown={captureCreateSource}
			placeholder={placeholder}
			ref={inputRef}
		/>
	);
	return (
		<>
			{multiple ? (
				<ComboboxChips data-slot="combobox-chips" data-variant={variant}>
					<ComboboxValue>
						{(state) =>
							(Array.isArray(state.value) ? state.value : []).map(
								(selected, index) => {
									const label = state.labels[index] ?? "selection";
									const option = options.find((item) =>
										isItemEqualToValue
											? isItemEqualToValue(item.value, selected)
											: Object.is(item.value, selected),
									);
									const key =
										option?.id ??
										itemToValue?.(selected) ??
										option?.label ??
										index;
									return (
										<ComboboxChip
											data-tone={valueTone?.(selected) ?? "default"}
											key={key}
											value={selected}
										>
											{label}
											<ComboboxChipRemove aria-label={`Remove ${label}`} />
										</ComboboxChip>
									);
								},
							)
						}
					</ComboboxValue>
					{input}
				</ComboboxChips>
			) : (
				<div data-slot="combobox-anchor" data-variant={variant}>
					{input}
					{disclosureLabel ? (
						<ComboboxTrigger
							aria-label={disclosureLabel}
							disabled={readOnly || undefined}
							tabIndex={-1}
						>
							<Icon icon={ChevronDown} size={12} />
						</ComboboxTrigger>
					) : null}
				</div>
			)}
			<ComboboxContent data-slot="combobox-content" sideOffset={4}>
				<ComboboxList data-slot="combobox-list">
					{options.map((option) => (
						<ComboboxItem
							data-slot="combobox-item"
							disabled={option.disabled}
							key={option.id ?? option.label}
							label={option.label}
							value={option.value}
						>
							{option.icon ? (
								<ComboboxItemIcon data-slot="combobox-item-icon">
									{option.icon}
								</ComboboxItemIcon>
							) : null}
							<span data-slot="combobox-item-body">
								<ComboboxItemText data-slot="combobox-item-text">
									{option.label}
								</ComboboxItemText>
								{option.description ? (
									<span data-slot="combobox-item-description">
										{option.description}
									</span>
								) : null}
							</span>
							<ComboboxItemIndicator data-slot="combobox-indicator">
								✓
							</ComboboxItemIndicator>
						</ComboboxItem>
					))}
					{onCreate ? (
						<ComboboxCreate
							data-slot="combobox-create"
							onCreate={(query) => {
								const source = createSource.current;
								createSource.current = "agent";
								return onCreate(query, { source });
							}}
							onKeyDown={captureCreateSource}
							onPointerDown={captureCreateSource}
							render={(createProps) => {
								const {
									"data-slot": slot,
									onClick,
									...buttonProps
								} = createProps;
								return (
									<BehaviorButton
										{...buttonProps}
										onClick={(event) => onClick?.(event)}
										render={<button data-slot={slot} type="button" />}
									/>
								);
							}}
						>
							{(state) => createLabel?.(state.query) ?? `Create ${state.query}`}
						</ComboboxCreate>
					) : null}
					<ComboboxEmpty data-slot="combobox-empty">{emptyLabel}</ComboboxEmpty>
				</ComboboxList>
			</ComboboxContent>
		</>
	);
}
