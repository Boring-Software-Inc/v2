import {
	type ComponentProps,
	createContext,
	type ReactNode,
	useContext,
} from "react";
import { Button } from "./button";
import type { InteractionDetails } from "./interaction";

export type StepState = "done" | "current" | "upcoming" | "pending" | "error";
export type StepsSize = "small" | "default";
export type StepsOrientation = "horizontal" | "vertical";

interface StepsContextValue {
	linear: boolean;
	onValueChange?: (step: number, details: InteractionDetails) => unknown;
	orientation: StepsOrientation;
	size: StepsSize;
	value: number;
}

interface StepContextValue {
	disabled: boolean;
	state: StepState;
	step: number;
}

const StepsContext = createContext<StepsContextValue | null>(null);
const StepContext = createContext<StepContextValue | null>(null);

function useSteps() {
	const context = useContext(StepsContext);
	if (!context) throw new Error("Step parts must be inside Steps.");
	return context;
}

function useStep() {
	const context = useContext(StepContext);
	if (!context) throw new Error("Step parts must be inside Step.");
	return context;
}

export interface StepsProps extends Omit<ComponentProps<"ol">, "onChange"> {
	linear?: boolean;
	onValueChange?: (step: number, details: InteractionDetails) => unknown;
	orientation?: StepsOrientation;
	size?: StepsSize;
	value: number;
}

export function Steps({
	linear = true,
	onValueChange,
	orientation = "horizontal",
	size = "default",
	value,
	...props
}: StepsProps) {
	return (
		<StepsContext value={{ linear, onValueChange, orientation, size, value }}>
			<ol
				data-orientation={orientation}
				data-size={size}
				data-slot="steps"
				{...props}
			/>
		</StepsContext>
	);
}

export interface StepProps extends ComponentProps<"li"> {
	disabled?: boolean;
	state?: StepState;
	step: number;
}

export function Step({
	disabled = false,
	state: stateProp,
	step,
	...props
}: StepProps) {
	const { size, value } = useSteps();
	const state =
		stateProp ??
		(step < value ? "done" : step === value ? "current" : "upcoming");
	return (
		<StepContext value={{ disabled, state, step }}>
			<li
				aria-current={step === value ? "step" : undefined}
				data-size={size}
				data-slot="step"
				data-state={state}
				{...props}
			/>
		</StepContext>
	);
}

export function StepTrigger({
	children,
	...props
}: Omit<ComponentProps<"span">, "onClick">) {
	const { linear, onValueChange, value } = useSteps();
	const { disabled, step } = useStep();
	if (!onValueChange) {
		return (
			<span data-slot="step-trigger" {...props}>
				{children}
			</span>
		);
	}
	return (
		<span data-slot="step-trigger" {...props}>
			<Button
				disabled={disabled || (linear && step > value)}
				onAction={(details) => onValueChange(step, details)}
				size="small"
				variant="ghost"
			>
				{children as ReactNode}
			</Button>
		</span>
	);
}

export function StepIndicator({ children, ...props }: ComponentProps<"span">) {
	const { state, step } = useStep();
	return (
		<span
			aria-hidden="true"
			data-slot="step-indicator"
			data-state={state}
			{...props}
		>
			{children ?? (state === "done" ? "✓" : state === "error" ? "×" : step)}
		</span>
	);
}

export function StepText(props: ComponentProps<"span">) {
	return <span data-slot="step-text" {...props} />;
}

export interface StepTitleProps extends ComponentProps<"span"> {
	errorText?: ReactNode;
}

export function StepTitle({
	children,
	errorText = "Failed",
	...props
}: StepTitleProps) {
	const { state } = useStep();
	return (
		<span data-slot="step-title" {...props}>
			{children}
			{state === "error" ? (
				<span data-slot="step-error">{errorText}</span>
			) : null}
		</span>
	);
}

export function StepDescription(props: ComponentProps<"span">) {
	return <span data-slot="step-description" {...props} />;
}

export function StepSeparator(props: ComponentProps<"span">) {
	const { value } = useSteps();
	const { step } = useStep();
	return (
		<span
			aria-hidden="true"
			data-filled={step < value || undefined}
			data-slot="step-separator"
			{...props}
		/>
	);
}
