import { definePrimitive } from "@ui-sdk/core";
import { usePart, usePrimitive } from "@ui-sdk/react/primitive";
import {
	Slider as BehaviorSlider,
	createSliderController,
	SliderControl,
	SliderIndicator,
	SliderThumb,
	SliderTrack,
	SliderValue,
} from "@ui-sdk/react/slider";
import { useEffect, useRef, useState } from "react";
import type { AccessibleName } from "./accessible-name";
import { type InteractionDetails, interactionDetails } from "./interaction";

interface SliderOptions {
	disabled?: boolean;
	formatOptions?: Intl.NumberFormatOptions;
	getValueText?: (value: number) => string;
	max?: number;
	min?: number;
	onValueChange?: (value: number, details: InteractionDetails) => void;
	onValueCommit?: (value: number, details: InteractionDetails) => void;
	readOnly?: boolean;
	showValue?: boolean;
	step?: number;
	name?: string;
	ticks?: readonly SliderTick[];
}

type SliderStateProps =
	| { defaultValue?: number; value?: never }
	| { defaultValue?: never; value: number };

export type SliderProps = SliderOptions & AccessibleName & SliderStateProps;

export interface SliderTick {
	label: string;
	value: number;
}

interface StepSliderAgentOptions {
	value: number;
	disabled: boolean;
	readOnly: boolean;
	getSteps: () => readonly SliderTick[];
	onSetValue: (value: number) => boolean;
}

const stepSliderAgent = definePrimitive({
	name: "step-slider",
	options: {
		value: "number",
		disabled: "boolean",
		readOnly: "boolean",
		onSetValue: "callback",
		getSteps: "callback",
	},
	state: ({ value, disabled, readOnly }: StepSliderAgentOptions) => ({
		value,
		disabled,
		readOnly,
	}),
	sync: ({ value, disabled, readOnly }) => ({ value, disabled, readOnly }),
	api(context) {
		return {
			setValue(value: number) {
				const { disabled, readOnly } = context.store.get();
				return !disabled && !readOnly && context.options().onSetValue(value);
			},
			items: () =>
				context
					.options()
					.getSteps()
					.map((step) => ({
						value: String(step.value),
						label: step.label || String(step.value),
					})),
		};
	},
	agent: { actions: ["setValue"], closed: true, items: (api) => api.items() },
	slots: (slot) => ({
		root: slot({ attrs: () => ({ "data-slot": "step-slider" }) }),
	}),
});

function StepSliderSweep({
	active,
	value,
}: {
	active: boolean;
	value: number | number[];
}) {
	const first = useRef<HTMLSpanElement>(null);
	const second = useRef<HTMLSpanElement>(null);
	const animations = useRef<(Animation | undefined)[]>([]);
	const currentBand = useRef(0);
	const previous = useRef(value);
	useEffect(() => {
		const changed = previous.current !== value;
		previous.current = value;
		if (
			!active ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			for (const animation of animations.current) animation?.cancel();
			return;
		}
		if (!changed) return;
		const running = animations.current[currentBand.current];
		const inFlight =
			running &&
			running.playState !== "finished" &&
			running.playState !== "idle";
		const progress = running?.effect?.getComputedTiming().progress ?? 0;
		if (inFlight && progress < 8 / 11) return;
		if (inFlight) currentBand.current = 1 - currentBand.current;
		const element = currentBand.current === 0 ? first.current : second.current;
		if (!element) return;
		const timing = getComputedStyle(element);
		const duration = Number.parseFloat(timing.animationDuration) * 1000;
		if (duration > 0) {
			animations.current[currentBand.current]?.cancel();
			animations.current[currentBand.current] = element.animate(
				[{ maskPosition: "-60% 0" }, { maskPosition: "160% 0" }],
				{ duration, easing: "ease-out" },
			);
		}
	}, [active, value]);
	return (
		<>
			<span data-slot="step-slider-sweep" ref={first} />
			<span data-slot="step-slider-sweep" ref={second} />
		</>
	);
}

export function Slider(props: SliderProps) {
	return <SliderControlSurface {...props} />;
}

function SliderControlSurface({
	ariaLabel,
	ariaLabelledBy,
	defaultValue,
	disabled,
	formatOptions,
	getValueText,
	max = 100,
	min = 0,
	name,
	onValueChange,
	onValueCommit,
	readOnly,
	showValue = false,
	step = 1,
	ticks,
	stops,
	controller,
	value,
}: SliderProps & {
	stops?: readonly SliderTick[];
	controller?: ReturnType<typeof createSliderController<number>>;
}) {
	const pointer = useRef<InteractionDetails["source"]>("mouse");
	const [current, setCurrent] = useState(defaultValue ?? min);
	const displayed = value ?? current;
	const formatValue =
		getValueText ?? new Intl.NumberFormat("en-US", formatOptions).format;
	const last = min + Math.floor((max - min) / (step || 1)) * step;
	const reserve = (
		stops
			? stops.map((_, index) => formatValue(index))
			: [min, Math.min(last, min + step), Math.max(min, last - step), last].map(
					formatValue,
				)
	).reduce(
		(longest, candidate) =>
			candidate.length > longest.length ? candidate : longest,
		"",
	);
	return (
		<BehaviorSlider<number>
			controller={controller}
			data-agent-hidden={stops ? "" : undefined}
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			data-slot="slider"
			data-stepped={stops ? "" : undefined}
			defaultValue={defaultValue}
			disabled={disabled}
			format={getValueText ?? formatOptions}
			locale="en-US"
			max={max}
			min={min}
			name={name}
			onValueChange={(nextValue, details) => {
				if (stops && value === undefined) setCurrent(nextValue);
				onValueChange?.(nextValue, interactionDetails(details));
			}}
			onValueCommit={(nextValue, details) => {
				const source =
					details.source === "virtual" &&
					(details.reason === "drag" || details.reason === "track-press")
						? pointer.current
						: details.source;
				onValueCommit?.(nextValue, { source });
			}}
			readOnly={readOnly}
			step={step}
			value={value}
		>
			<SliderControl
				data-slot="slider-control"
				onPointerDownCapture={(event) => {
					pointer.current =
						event.pointerType === "touch" || event.pointerType === "pen"
							? event.pointerType
							: "mouse";
				}}
			>
				<SliderTrack data-slot="slider-track">
					<SliderIndicator data-slot="slider-indicator">
						{stops ? (
							<span
								data-empty={displayed === 0 ? "" : undefined}
								data-slot="step-slider-fill"
								aria-hidden="true"
							>
								<span data-slot="step-slider-dots" />
								<StepSliderSweep active={!disabled} value={displayed} />
							</span>
						) : null}
					</SliderIndicator>
					{stops?.map((stop, index) => (
						<span
							aria-hidden
							data-major={stop.label ? "" : undefined}
							data-slot="step-slider-stop"
							key={stop.value}
							style={{
								insetInlineStart: `${(100 * index) / Math.max(stops.length - 1, 1)}%`,
							}}
						>
							<SliderValue data-slot="step-slider-stop-fill">
								{(state) => (
									<span
										data-current={state.value === index ? "" : undefined}
										data-filled={
											!Array.isArray(state.value) && index < state.value
												? ""
												: undefined
										}
									/>
								)}
							</SliderValue>
						</span>
					))}
					<SliderThumb
						aria-label={ariaLabel}
						aria-labelledby={ariaLabelledBy}
						data-slot="slider-thumb"
					/>
				</SliderTrack>
			</SliderControl>
			{showValue ? (
				<span data-slot="slider-value">
					<span aria-hidden="true" data-slot="slider-value-reserve">
						{reserve}
					</span>
					<SliderValue data-slot="slider-value-text" />
				</span>
			) : null}
			{ticks?.length ? (
				<div aria-hidden="true" data-slot="slider-ticks">
					{ticks
						.filter((tick) => tick.label)
						.map((tick) => (
							<span
								data-slot="slider-tick"
								data-edge={
									tick.value === (stops?.[0]?.value ?? min)
										? "start"
										: tick.value === (stops?.at(-1)?.value ?? last)
											? "end"
											: undefined
								}
								key={tick.value}
								style={{
									insetInlineStart: `${
										100 *
										(stops
											? stops.findIndex((stop) => stop.value === tick.value) /
												Math.max(stops.length - 1, 1)
											: Math.min(
													1,
													Math.max(0, (tick.value - min) / (last - min || 1)),
												))
									}%`,
								}}
							>
								{tick.label}
							</span>
						))}
				</div>
			) : null}
		</BehaviorSlider>
	);
}

export type StepSliderProps = Omit<
	SliderOptions,
	"max" | "min" | "step" | "ticks" | "name"
> &
	AccessibleName &
	SliderStateProps & {
		showTickLabels?: boolean;
		steps: readonly SliderTick[];
	};

export function StepSlider({
	steps,
	value,
	defaultValue,
	onValueChange,
	onValueCommit,
	getValueText,
	showTickLabels = true,
	...props
}: StepSliderProps) {
	const ticks = steps;
	if (
		!ticks.length ||
		ticks.some(
			(tick, index) =>
				!Number.isFinite(tick.value) ||
				(index > 0 && tick.value <= (ticks[index - 1]?.value ?? tick.value)),
		)
	)
		return null;
	return (
		<ValidStepSlider
			tickStops={ticks}
			{...(value === undefined ? { defaultValue } : { value })}
			onValueChange={onValueChange}
			onValueCommit={onValueCommit}
			getValueText={getValueText}
			showTickLabels={showTickLabels}
			{...props}
		/>
	);
}

function ValidStepSlider({
	tickStops: ticks,
	value,
	defaultValue,
	onValueChange,
	onValueCommit,
	getValueText,
	showTickLabels,
	...props
}: Omit<SliderOptions, "max" | "min" | "step" | "ticks" | "name"> &
	AccessibleName &
	SliderStateProps & {
		tickStops: readonly SliderTick[];
		showTickLabels: boolean;
	}) {
	const indexOf = (target: number) =>
		ticks.reduce(
			(best, tick, index) =>
				Math.abs(tick.value - target) <
				Math.abs((ticks[best]?.value ?? target) - target)
					? index
					: best,
			0,
		);
	const state =
		value === undefined
			? { defaultValue: indexOf(defaultValue ?? ticks[0]?.value ?? 0) }
			: { value: indexOf(value) };
	const valueAt = (index: number) =>
		ticks[index]?.value ?? ticks[0]?.value ?? 0;
	const [controller] = useState(() => createSliderController<number>());
	const [current, setCurrent] = useState(() =>
		valueAt(indexOf(defaultValue ?? ticks[0]?.value ?? 0)),
	);
	const disabled = Boolean(props.disabled || ticks.length < 2);
	const agent = usePrimitive(stepSliderAgent, {
		disabled,
		readOnly: Boolean(props.readOnly),
		value: valueAt(indexOf(value ?? current)),
		getSteps: () =>
			ticks.map((tick) => ({
				...tick,
				label: getValueText?.(tick.value) || tick.label || String(tick.value),
			})),
		onSetValue: (target) => {
			const index = ticks.findIndex((tick) => tick.value === target);
			return index >= 0 && controller.setValue(index);
		},
	});
	return usePart(
		agent,
		"root",
		{},
		{
			"aria-label": props.ariaLabel,
			"aria-labelledby": props.ariaLabelledBy,
			children: (
				<SliderControlSurface
					{...props}
					{...state}
					controller={controller}
					disabled={disabled}
					getValueText={(index) =>
						getValueText?.(valueAt(index)) ||
						ticks[index]?.label ||
						String(valueAt(index))
					}
					max={Math.max(ticks.length - 1, 1)}
					min={0}
					onValueChange={(index, details) => {
						if (value === undefined) setCurrent(valueAt(index));
						onValueChange?.(valueAt(index), details);
					}}
					onValueCommit={(index, details) =>
						onValueCommit?.(valueAt(index), details)
					}
					step={1}
					stops={ticks}
					ticks={showTickLabels ? ticks : undefined}
				/>
			),
		},
		"div",
	);
}
