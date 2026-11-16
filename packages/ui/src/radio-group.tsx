import {
	RadioGroup as BehaviorRadioGroup,
	Radio,
	RadioIndicator,
} from "@ui-sdk/react/radio";
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { AccessibleName } from "./accessible-name";
import { Icon, type IconGlyph } from "./icon";
import { type InteractionDetails, interactionDetails } from "./interaction";

interface RadioOptionBase {
	badge?: string;
	count?: number;
	countMax?: number;
	description?: string;
	disabled?: boolean;
	label: string;
	value: string;
}

export type RadioOption = RadioOptionBase &
	(
		| { icon?: IconGlyph; iconOnly?: false }
		| { icon: IconGlyph; iconOnly: true }
	);

interface RadioGroupOptions {
	disabled?: boolean;
	form?: string;
	invalid?: boolean;
	loop?: boolean;
	name?: string;
	onValueChange?: (value: string | null, details: InteractionDetails) => void;
	options: readonly RadioOption[];
	readOnly?: boolean;
	required?: boolean;
}

type RadioGroupState =
	| { defaultValue?: string | null; value?: never }
	| { defaultValue?: never; value: string | null };

export type RadioGroupProps = RadioGroupOptions &
	RadioGroupState &
	AccessibleName;

function metadataText(option: RadioOption) {
	return [
		option.count === undefined
			? undefined
			: `${option.count.toLocaleString()} ${option.count === 1 ? "item" : "items"}`,
		option.badge,
	]
		.filter(Boolean)
		.join(", ");
}

function describedBy(
	descriptionId: string,
	metadataId: string,
	option: RadioOption,
) {
	return (
		[
			option.description ? descriptionId : undefined,
			metadataText(option) ? metadataId : undefined,
		]
			.filter(Boolean)
			.join(" ") || undefined
	);
}

function RadioOptionView({ option }: { option: RadioOption }) {
	const labelId = useId();
	const descriptionId = useId();
	const metadataId = useId();
	const iconOnlyName = option.iconOnly ? { "aria-label": option.label } : {};

	return (
		<div
			data-disabled={option.disabled ? "" : undefined}
			data-slot="radio-option"
		>
			<Radio
				{...iconOnlyName}
				aria-describedby={describedBy(descriptionId, metadataId, option)}
				aria-labelledby={option.iconOnly ? undefined : labelId}
				data-slot="radio"
				disabled={option.disabled}
				value={option.value}
			>
				<RadioIndicator data-slot="radio-indicator" />
			</Radio>
			<span
				aria-hidden={option.iconOnly || undefined}
				data-icon-only={option.iconOnly ? "" : undefined}
				data-slot="radio-label"
				id={option.iconOnly ? undefined : labelId}
			>
				{option.icon ? <Icon icon={option.icon} /> : null}
				{option.iconOnly ? null : (
					<span data-slot="radio-label-text" title={option.label}>
						{option.label}
					</span>
				)}
				{option.count === undefined ? null : (
					<SegmentedCount count={option.count} countMax={option.countMax} />
				)}
				{option.badge ? (
					<span aria-hidden="true" data-slot="radio-badge">
						{option.badge}
					</span>
				) : null}
			</span>
			{option.description ? (
				<span data-slot="radio-description" id={descriptionId}>
					{option.description}
				</span>
			) : null}
			{metadataText(option) ? (
				<span data-slot="radio-metadata" id={metadataId}>
					{metadataText(option)}
				</span>
			) : null}
		</div>
	);
}

export function RadioGroup({
	ariaLabel,
	ariaLabelledBy,
	defaultValue,
	disabled,
	form,
	invalid,
	loop,
	name,
	onValueChange,
	options,
	readOnly,
	required,
	value,
}: RadioGroupProps) {
	const groupRef = useRef<HTMLDivElement | null>(null);
	const [resetVersion, setResetVersion] = useState(0);
	useEffect(() => {
		if (value !== undefined) return;
		const owner = form
			? (document.getElementById(form) as HTMLFormElement | null)
			: groupRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')
					?.form;
		if (!owner) return;
		const reset = () => setResetVersion((current) => current + 1);
		owner.addEventListener("reset", reset);
		return () => owner.removeEventListener("reset", reset);
	}, [form, value]);

	return (
		<BehaviorRadioGroup
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			aria-invalid={invalid || undefined}
			data-invalid={invalid ? "" : undefined}
			data-slot="radio-group"
			defaultValue={defaultValue}
			disabled={disabled}
			form={form}
			loop={loop}
			name={name}
			onValueChange={(nextValue, details) =>
				onValueChange?.(nextValue, interactionDetails(details))
			}
			readOnly={readOnly}
			ref={groupRef}
			required={required}
			value={value}
			key={resetVersion}
		>
			{options.map((option) => (
				<RadioOptionView key={option.value} option={option} />
			))}
		</BehaviorRadioGroup>
	);
}

interface SegmentedControlOptions {
	countMax?: number;
	disabled?: boolean;
	fill?: boolean;
	loop?: boolean;
	options: readonly RadioOption[];
	size?: "default" | "small";
}

type SegmentedSingleState =
	| { defaultValue?: string | null; value?: never }
	| { defaultValue?: never; value: string | null };

type SegmentedMultipleState =
	| { defaultValue?: readonly string[]; value?: never }
	| { defaultValue?: never; value: readonly string[] };

type SegmentedSingleProps = SegmentedControlOptions &
	SegmentedSingleState & {
		multiple?: false;
		onValueChange?: (value: string | null, details: InteractionDetails) => void;
		readOnly?: boolean;
	} & AccessibleName;

type SegmentedMultipleProps = SegmentedControlOptions &
	SegmentedMultipleState & {
		multiple: true;
		onValueChange?: (
			value: readonly string[],
			details: InteractionDetails,
		) => void;
		readOnly?: never;
	} & AccessibleName;

export type SegmentedControlProps =
	| SegmentedSingleProps
	| SegmentedMultipleProps;

function SegmentedCount({
	count,
	countMax,
}: {
	count: number;
	countMax?: number;
}) {
	const widestRef = useRef(Math.max(count, countMax ?? count));
	widestRef.current = Math.max(widestRef.current, count, countMax ?? count);
	const reservedCount = widestRef.current.toLocaleString();
	const visibleCount = count.toLocaleString();
	return (
		<span aria-hidden="true" data-slot="segmented-count">
			<span data-slot="segmented-count-reserve">{reservedCount}</span>
			<span data-slot="segmented-count-value">{visibleCount}</span>
		</span>
	);
}

function SegmentedToggleOption({
	countMax,
	option,
}: {
	countMax?: number;
	option: RadioOption;
}) {
	const descriptionId = useId();
	const metadataId = useId();
	return (
		<Toggle
			aria-describedby={describedBy(descriptionId, metadataId, option)}
			aria-label={option.iconOnly ? option.label : undefined}
			data-disabled={option.disabled ? "" : undefined}
			data-icon-only={option.iconOnly ? "" : undefined}
			data-slot="segmented-toggle"
			disabled={option.disabled}
			value={option.value}
		>
			{option.icon ? <Icon icon={option.icon} /> : null}
			{option.iconOnly ? null : (
				<span data-slot="segmented-label-text" title={option.label}>
					{option.label}
				</span>
			)}
			{option.count === undefined ? null : (
				<SegmentedCount
					count={option.count}
					countMax={option.countMax ?? countMax}
				/>
			)}
			{option.badge ? (
				<span aria-hidden="true" data-slot="radio-badge">
					{option.badge}
				</span>
			) : null}
			{option.description ? (
				<span data-slot="radio-metadata" id={descriptionId}>
					{option.description}
				</span>
			) : null}
			{metadataText(option) ? (
				<span data-slot="radio-metadata" id={metadataId}>
					{metadataText(option)}
				</span>
			) : null}
		</Toggle>
	);
}

function useSegmentedThumb() {
	const groupRef = useRef<HTMLDivElement | null>(null);
	const thumbRef = useRef<HTMLSpanElement | null>(null);
	const [ready, setReady] = useState(false);

	useLayoutEffect(() => {
		const group = groupRef.current;
		const thumb = thumbRef.current;
		if (!(group && thumb)) return;
		const activeGroup = group;
		const activeThumb = thumb;

		let firstPlacement = true;
		const observed = new Set<Element>();
		function place() {
			const selected = activeGroup.querySelector<HTMLElement>(
				'[data-slot="radio"][data-checked]',
			)?.parentElement;
			activeThumb.hidden = !selected;
			if (!selected) return;
			const trackBounds = activeThumb.parentElement?.getBoundingClientRect();
			const selectedBounds = selected.getBoundingClientRect();
			if (!trackBounds) return;
			if (firstPlacement) activeThumb.style.transition = "none";
			activeGroup.parentElement?.style.setProperty(
				"--segmented-x",
				`${selectedBounds.left - trackBounds.left}px`,
			);
			activeGroup.parentElement?.style.setProperty(
				"--segmented-width",
				`${selectedBounds.width}px`,
			);
			activeThumb.toggleAttribute(
				"data-disabled",
				selected.hasAttribute("data-disabled"),
			);
			if (firstPlacement) {
				void activeThumb.offsetWidth;
				activeThumb.style.transition = "";
				firstPlacement = false;
			}
		}
		const resize = new ResizeObserver(place);
		function observeOptions() {
			activeGroup
				.querySelectorAll<HTMLElement>('[data-slot="radio-option"]')
				.forEach((option) => {
					if (observed.has(option)) return;
					observed.add(option);
					resize.observe(option);
				});
		}

		observeOptions();
		place();
		setReady(true);
		const mutations = new MutationObserver(() => {
			observeOptions();
			place();
		});
		mutations.observe(activeGroup, {
			attributeFilter: ["data-checked", "data-disabled"],
			attributes: true,
			childList: true,
			subtree: true,
		});
		resize.observe(activeGroup);
		return () => {
			mutations.disconnect();
			resize.disconnect();
		};
	}, []);

	return { groupRef, ready, thumbRef };
}

function accessibleNameOf(props: AccessibleName) {
	return props.ariaLabel
		? { "aria-label": props.ariaLabel }
		: { "aria-labelledby": props.ariaLabelledBy };
}

function MultipleSegmentedControl(props: SegmentedMultipleProps) {
	const {
		ariaLabel,
		ariaLabelledBy,
		countMax,
		defaultValue,
		disabled,
		fill,
		loop,
		onValueChange,
		options,
		size = "default",
		value,
	} = props;
	const state =
		value !== undefined
			? { value: [...value] }
			: { defaultValue: [...(defaultValue ?? [])] };
	const accessibleName = ariaLabel
		? { ariaLabel }
		: { ariaLabelledBy: ariaLabelledBy as string };
	return (
		<div
			data-fill={fill ? "" : undefined}
			data-multiple=""
			data-size={size}
			data-slot="segmented-control"
		>
			<ToggleGroup
				{...accessibleNameOf(accessibleName)}
				{...state}
				data-slot="segmented-toggle-group"
				disabled={disabled}
				loop={loop}
				multiple
				onValueChange={(nextValue, details) =>
					onValueChange?.(nextValue, interactionDetails(details))
				}
			>
				{options.map((option) => (
					<SegmentedToggleOption
						countMax={countMax}
						key={option.value}
						option={option}
					/>
				))}
			</ToggleGroup>
		</div>
	);
}

function SingleSegmentedControl(props: SegmentedSingleProps) {
	const {
		ariaLabel,
		ariaLabelledBy,
		countMax,
		defaultValue,
		disabled,
		fill,
		loop,
		onValueChange,
		options,
		readOnly,
		size = "default",
		value,
	} = props;
	const accessibleName = ariaLabel
		? { ariaLabel }
		: { ariaLabelledBy: ariaLabelledBy as string };
	const state =
		value !== undefined ? { value } : { defaultValue: defaultValue ?? null };
	const { groupRef, ready, thumbRef } = useSegmentedThumb();
	const optionsWithMax = options.map((option) => ({
		...option,
		countMax: option.countMax ?? countMax,
	}));
	return (
		<div
			data-fill={fill ? "" : undefined}
			data-ready={ready ? "" : undefined}
			data-size={size}
			data-slot="segmented-control"
		>
			<span
				aria-hidden="true"
				data-slot="segmented-control-thumb"
				ref={thumbRef}
			/>
			<div data-slot="segmented-control-group" ref={groupRef}>
				<RadioGroup
					{...accessibleName}
					{...state}
					disabled={disabled}
					loop={loop}
					onValueChange={onValueChange}
					options={optionsWithMax}
					readOnly={readOnly}
				/>
			</div>
		</div>
	);
}

export function SegmentedControl(props: SegmentedControlProps) {
	return props.multiple ? (
		<MultipleSegmentedControl {...props} />
	) : (
		<SingleSegmentedControl {...props} />
	);
}
