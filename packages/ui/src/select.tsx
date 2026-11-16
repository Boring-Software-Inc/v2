import {
	Select as BehaviorSelect,
	SelectContent,
	SelectEmpty,
	SelectItem,
	SelectItemIcon,
	SelectItemIndicator,
	SelectItemText,
	SelectList,
	SelectTrigger,
	SelectValue,
	SelectValueIcon,
} from "@ui-sdk/react/select";
import {
	type ChangeEvent,
	type PointerEvent,
	useEffect,
	useId,
	useState,
} from "react";
import type { AccessibleName } from "./accessible-name";
import {
	Check,
	ChevronDown,
	ChevronSort,
	ChevronUp,
	Icon,
	type IconGlyph,
} from "./icon";
import { type InteractionDetails, interactionFromEvent } from "./interaction";

export type SelectSize = "small" | "medium" | "large";

type NonEmptySelectValue<T extends string> = T extends "" ? never : T;

export interface SelectOption<T extends string = string> {
	description?: string;
	disabled?: boolean;
	icon?: IconGlyph;
	label: string;
	metadata?: string;
	value: NonEmptySelectValue<T>;
}

interface SelectCommonOptions<T extends string> {
	ariaDescribedBy?: string;
	disabled?: boolean;
	emptyMessage?: string;
	form?: string;
	id?: string;
	invalid?: boolean;
	name?: string;
	onValueChange?: (value: T | null, details: InteractionDetails) => void;
	options: readonly SelectOption<T>[];
	placeholder?: string;
	required?: boolean;
	size?: SelectSize;
}

type SelectState<T extends string> =
	| { defaultValue?: T | null; value?: never }
	| { defaultValue?: never; value: T | null };

type PopupSelectOptions = {
	loop?: boolean;
	mode?: "popup";
	readOnly?: boolean;
};

type NativeSelectOptions = {
	loop?: never;
	mode: "native";
	readOnly?: never;
};

type PopupSelectProps<T extends string> = SelectCommonOptions<T> &
	SelectState<NoInfer<T>> &
	PopupSelectOptions &
	AccessibleName;

type NativeSelectProps<T extends string> = SelectCommonOptions<T> &
	SelectState<NoInfer<T>> &
	NativeSelectOptions &
	AccessibleName;

export type SelectProps<T extends string = string> =
	| PopupSelectProps<T>
	| NativeSelectProps<T>;

function NativeSelect<T extends string>({
	ariaDescribedBy,
	ariaLabel,
	ariaLabelledBy,
	defaultValue,
	disabled,
	emptyMessage = "No options available",
	form,
	id,
	invalid,
	name,
	onValueChange,
	options,
	placeholder,
	required,
	size = "medium",
	value,
}: NativeSelectProps<T>) {
	const iconSize = size === "small" ? 12 : size === "large" ? 16 : 14;
	const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
		const option = options.find(
			(candidate) => candidate.value === event.currentTarget.value,
		);
		onValueChange?.(
			option?.value ?? null,
			interactionFromEvent(event.nativeEvent),
		);
	};

	return (
		<span
			data-disabled={disabled ? "" : undefined}
			data-slot="select-native-frame"
		>
			<select
				aria-describedby={ariaDescribedBy}
				aria-invalid={invalid || undefined}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy}
				data-size={size}
				data-slot="select-native"
				defaultValue={value === undefined ? (defaultValue ?? "") : undefined}
				disabled={disabled}
				form={form}
				id={id}
				name={name}
				onChange={handleChange}
				required={required}
				value={value === undefined ? undefined : (value ?? "")}
			>
				<option disabled={required} value="">
					{placeholder ??
						(options.length === 0 ? emptyMessage : "No selection")}
				</option>
				{options.map((option) => (
					<option
						disabled={option.disabled}
						key={option.value}
						value={option.value}
					>
						{option.label}
					</option>
				))}
			</select>
			<span aria-hidden="true" data-slot="select-caret">
				<Icon icon={ChevronSort} size={iconSize} />
			</span>
		</span>
	);
}

interface SelectScrollState {
	down: boolean;
	up: boolean;
}

function SelectScrollButton({
	direction,
	list,
}: {
	direction: "down" | "up";
	list: HTMLDivElement;
}) {
	const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		list.scrollBy({
			top:
				direction === "up"
					? -Math.max(list.clientHeight / 2, 32)
					: Math.max(list.clientHeight / 2, 32),
		});
	};

	return (
		<button
			aria-label={`Scroll options ${direction}`}
			data-direction={direction}
			data-slot="select-scroll-button"
			onPointerDown={handlePointerDown}
			tabIndex={-1}
			type="button"
		>
			<Icon icon={direction === "up" ? ChevronUp : ChevronDown} size={12} />
		</button>
	);
}

function PopupSelectItem<T extends string>({
	iconSize,
	option,
}: {
	iconSize: 12 | 14 | 16;
	option: SelectOption<T>;
}) {
	const descriptionId = useId();

	return (
		<SelectItem
			aria-describedby={option.description ? descriptionId : undefined}
			aria-label={option.label}
			data-has-description={option.description ? "" : undefined}
			data-slot="select-item"
			disabled={option.disabled}
			label={option.label}
			value={option.value}
		>
			<SelectItemIndicator>
				<Icon icon={Check} size={iconSize} />
			</SelectItemIndicator>
			{option.icon ? (
				<SelectItemIcon data-slot="select-item-icon">
					<Icon icon={option.icon} size={iconSize} />
				</SelectItemIcon>
			) : null}
			<span data-slot="select-item-copy">
				<SelectItemText data-slot="select-item-label" title={option.label}>
					{option.label}
				</SelectItemText>
				{option.description ? (
					<span data-slot="select-item-description" id={descriptionId}>
						{option.description}
					</span>
				) : null}
			</span>
			{option.metadata ? (
				<span aria-hidden="true" data-slot="select-item-metadata">
					{option.metadata}
				</span>
			) : null}
		</SelectItem>
	);
}

function PopupSelect<T extends string>(props: PopupSelectProps<T>) {
	const {
		ariaDescribedBy,
		ariaLabel,
		ariaLabelledBy,
		defaultValue,
		disabled,
		emptyMessage = "No options available",
		form,
		id,
		invalid,
		loop,
		name,
		onValueChange,
		options,
		placeholder,
		readOnly,
		required,
		size = "medium",
		value,
	} = props;
	const iconSize = size === "small" ? 12 : size === "large" ? 16 : 14;
	const [list, setList] = useState<HTMLDivElement | null>(null);
	const [scrollState, setScrollState] = useState<SelectScrollState>({
		down: false,
		up: false,
	});
	useEffect(() => {
		if (!list) {
			setScrollState({ down: false, up: false });
			return;
		}
		const update = () => {
			const maximum = list.scrollHeight - list.clientHeight;
			setScrollState({
				down: maximum > 1 && list.scrollTop < maximum - 1,
				up: list.scrollTop > 1,
			});
		};
		update();
		list.addEventListener("scroll", update, { passive: true });
		const observer = new ResizeObserver(update);
		observer.observe(list);
		const observeChildren = () => {
			for (const child of list.children) observer.observe(child);
		};
		observeChildren();
		const mutations = new MutationObserver(() => {
			observeChildren();
			update();
		});
		mutations.observe(list, { childList: true, subtree: true });
		return () => {
			list.removeEventListener("scroll", update);
			mutations.disconnect();
			observer.disconnect();
		};
	}, [list]);
	const state =
		value === undefined
			? { defaultValue }
			: {
					value,
				};

	return (
		<BehaviorSelect<T>
			{...state}
			disabled={disabled}
			form={form}
			itemToLabel={(item) =>
				options.find((option) => option.value === item)?.label ?? ""
			}
			itemToValue={(item) => item}
			items={options.map((option) => ({
				disabled: option.disabled,
				label: option.label,
				value: option.value,
			}))}
			loop={loop}
			name={name}
			onValueChange={(nextValue, details) =>
				onValueChange?.(nextValue, { source: details.source })
			}
			readOnly={readOnly}
			required={required}
		>
			<SelectTrigger
				aria-describedby={ariaDescribedBy}
				aria-invalid={invalid || undefined}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy}
				data-invalid={invalid ? "" : undefined}
				data-readonly={readOnly ? "" : undefined}
				data-size={size}
				data-slot="select-trigger"
				disabled={disabled}
				id={id}
			>
				<SelectValueIcon data-slot="select-value-icon" />
				<SelectValue data-slot="select-value" placeholder={placeholder} />
				<span aria-hidden="true" data-slot="select-caret">
					<Icon icon={ChevronSort} size={iconSize} />
				</span>
			</SelectTrigger>
			<SelectContent data-size={size} data-slot="select-content" sideOffset={6}>
				{scrollState.up && list ? (
					<SelectScrollButton direction="up" list={list} />
				) : null}
				<SelectList data-slot="select-list" ref={setList}>
					{options.map((option) => (
						<PopupSelectItem
							iconSize={iconSize}
							key={option.value}
							option={option}
						/>
					))}
				</SelectList>
				{options.length === 0 ? (
					<SelectEmpty data-slot="select-empty">{emptyMessage}</SelectEmpty>
				) : null}
				{scrollState.down && list ? (
					<SelectScrollButton direction="down" list={list} />
				) : null}
			</SelectContent>
		</BehaviorSelect>
	);
}

export function Select<T extends string = string>(props: SelectProps<T>) {
	if (props.options.some((option) => option.value.length === 0)) {
		throw new Error("Select option values must be non-empty strings.");
	}
	return props.mode === "native" ? (
		<NativeSelect {...props} />
	) : (
		<PopupSelect {...props} />
	);
}
