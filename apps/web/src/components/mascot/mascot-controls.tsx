import type { ReactNode } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/glaze/ui/card";
import { Chip, ChipGroup } from "#/components/glaze/ui/chip";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "#/components/glaze/ui/field";
import { Slider } from "#/components/glaze/ui/slider";
import { Switch } from "#/components/glaze/ui/switch";
import type { MascotSettings } from "#/components/mascot/engine";
import { EXPRESSIONS, type Expression } from "#/components/mascot/geometry";
import type { MascotEvent } from "#/components/mascot/machine";

export type MascotControlsProps = {
	settings: MascotSettings;
	onSettings: (update: (prev: MascotSettings) => MascotSettings) => void;
	onSend: (event: MascotEvent) => void;
	sage: boolean;
	onSage: (on: boolean) => void;
	debug: boolean;
	onDebug: (on: boolean) => void;
	systemReduced: boolean;
};

const EVENT_BUTTONS: { event: MascotEvent; label: string }[] = [
	{ event: "POKE", label: "Poke" },
	{ event: "TALK", label: "Talk" },
	{ event: "STOP_TALK", label: "Stop talking" },
	{ event: "SLEEP", label: "Sleep" },
	{ event: "WAKE", label: "Wake" },
	{ event: "ANGER", label: "Get angry" },
	{ event: "SURPRISE", label: "Surprise" },
	{ event: "CHEER", label: "Cheer" },
	{ event: "SPLOOT", label: "Sploot" },
];

const EXPRESSION_LABELS: Record<Expression, string> = {
	neutral: "Neutral",
	happy: "Happy",
	angry: "Angry",
	sleepy: "Sleepy",
	talking: "Talking",
	surprised: "Surprised",
};

const percent = { style: "percent" } as const;
const times = { maximumFractionDigits: 2, minimumFractionDigits: 2 } as const;

function first(value: number | readonly number[]) {
	return typeof value === "number" ? value : (value[0] ?? 0);
}

function SliderField({
	label,
	description,
	value,
	min,
	max,
	step,
	format,
	onChange,
}: {
	label: string;
	description?: string;
	value: number;
	min: number;
	max: number;
	step: number;
	format?: Intl.NumberFormatOptions;
	onChange: (value: number) => void;
}) {
	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			<Slider
				format={format}
				max={max}
				min={min}
				onValueChange={(v) => onChange(first(v))}
				showValue
				step={step}
				thumbLabels={[label]}
				value={value}
			/>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
		</Field>
	);
}

function SwitchField({
	label,
	description,
	checked,
	onChange,
	disabled,
}: {
	label: string;
	description?: ReactNode;
	checked: boolean;
	onChange: (on: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<Field orientation="horizontal">
			<FieldContent>
				<FieldLabel>{label}</FieldLabel>
				{description ? (
					<FieldDescription>{description}</FieldDescription>
				) : null}
			</FieldContent>
			<Switch
				checked={checked}
				disabled={disabled}
				onCheckedChange={onChange}
			/>
		</Field>
	);
}

export function MascotControls({
	settings,
	onSettings,
	onSend,
	sage,
	onSage,
	debug,
	onDebug,
	systemReduced,
}: MascotControlsProps) {
	const set =
		<K extends keyof MascotSettings>(key: K) =>
		(value: MascotSettings[K]) =>
			onSettings((prev) => ({ ...prev, [key]: value }));

	return (
		<aside className="flex w-full flex-col gap-4 lg:w-96 lg:shrink-0">
			<Card>
				<CardHeader>
					<CardTitle>Events</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						<Button onClick={() => onSend("HOP")} size="sm">
							Hop
						</Button>
						{EVENT_BUTTONS.map(({ event, label }) => (
							<Button
								key={event}
								onClick={() => onSend(event)}
								size="sm"
								variant="secondary"
							>
								{label}
							</Button>
						))}
					</div>
					<p className="type-caption text-text-2">
						Sploot is a prototype: a drip falls from the hem and puddles.
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Resting face</CardTitle>
				</CardHeader>
				<CardContent>
					<ChipGroup aria-label="Resting face" role="group">
						{EXPRESSIONS.map((expr) => (
							<Chip
								key={expr}
								onPressedChange={() => set("resting")(expr)}
								pressed={settings.resting === expr}
							>
								{EXPRESSION_LABELS[expr]}
							</Chip>
						))}
					</ChipGroup>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Motion</CardTitle>
				</CardHeader>
				<CardContent>
					<SliderField
						description="Share of the v7 squash, stretch, bow, lean, keystone, tilt and cheek push. 60% is the default."
						format={percent}
						label="Intensity"
						max={1.5}
						min={0}
						onChange={set("intensity")}
						step={0.05}
						value={settings.intensity}
					/>
					<SliderField
						format={times}
						label="Speed"
						max={2}
						min={0.25}
						onChange={set("speed")}
						step={0.05}
						value={settings.speed}
					/>
					<SliderField
						label="Float bob"
						max={8}
						min={0}
						onChange={set("bob")}
						step={0.5}
						value={settings.bob}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Behaviour</CardTitle>
				</CardHeader>
				<CardContent>
					<SwitchField
						checked={settings.follow}
						label="Eyes follow cursor"
						onChange={set("follow")}
					/>
					<SwitchField
						checked={settings.autoBlink}
						label="Auto-blink"
						onChange={set("autoBlink")}
					/>
					<SwitchField
						checked={settings.autoSleep}
						description="Gets sleepy after 14 seconds of idle."
						label="Auto-sleep"
						onChange={set("autoSleep")}
					/>
					<SwitchField
						checked={settings.reduced || systemReduced}
						description={
							systemReduced
								? "On because the system asks for reduced motion."
								: "Simulates prefers-reduced-motion."
						}
						disabled={systemReduced}
						label="Reduced motion"
						onChange={set("reduced")}
					/>
					<SwitchField checked={sage} label="Sage variant" onChange={onSage} />
					<SwitchField
						checked={debug}
						label="Show state machine"
						onChange={onDebug}
					/>
				</CardContent>
			</Card>
		</aside>
	);
}
