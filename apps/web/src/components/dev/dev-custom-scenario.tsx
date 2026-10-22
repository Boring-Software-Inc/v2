import { DEV_CUSTOM_KEY } from "#/components/dev/use-dev-actions";
import { Button } from "#/components/glaze/ui/button";
import { Field, FieldLabel } from "#/components/glaze/ui/field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/glaze/ui/select";
import {
	blockedReason,
	DEV_AXES,
	DEV_AXIS_LABELS,
	DEV_LATENCIES,
	DEV_LATENCY_LABELS,
	DEV_OPTION_LABELS,
	DEV_OPTIONS,
	type DevAxis,
	type DevLatency,
	type DevPreset,
	type DevScenario,
} from "#/lib/dev/scenarios";

interface DevAxisSelectProps<A extends DevAxis> {
	axis: A;
	scenario: DevScenario;
	onChange: (axis: A, value: DevScenario[A]) => void;
}

function DevAxisSelect<A extends DevAxis>({
	axis,
	scenario,
	onChange,
}: DevAxisSelectProps<A>) {
	const options: readonly DevScenario[A][] = DEV_OPTIONS[axis];
	const labels: Record<DevScenario[A], string> = DEV_OPTION_LABELS[axis];
	const items = options.map((option) => ({
		value: option,
		label: labels[option],
	}));
	return (
		<Field>
			<FieldLabel>{DEV_AXIS_LABELS[axis]}</FieldLabel>
			<Select
				items={items}
				onValueChange={(value) => {
					const next = options.find((option) => option === value);
					if (next !== undefined) {
						onChange(axis, next);
					}
				}}
				value={scenario[axis]}
			>
				<SelectTrigger size="sm">
					<SelectValue />
				</SelectTrigger>
				<SelectContent size="sm">
					{options.map((option) => {
						const reason = blockedReason(scenario, axis, option);
						return (
							<SelectItem
								className={reason ? "py-1" : undefined}
								disabled={reason !== null}
								key={option}
								value={option}
							>
								<span className="block truncate">{labels[option]}</span>
								{reason ? (
									<span className="block truncate type-caption">{reason}</span>
								) : null}
							</SelectItem>
						);
					})}
				</SelectContent>
			</Select>
		</Field>
	);
}

interface DevCustomScenarioProps {
	busy: string | null;
	latency: DevLatency;
	match: DevPreset | undefined;
	onApply: () => void;
	onAxisChange: <A extends DevAxis>(axis: A, value: DevScenario[A]) => void;
	onLatencyChange: (latency: DevLatency) => void;
	scenario: DevScenario;
}

const LATENCY_ITEMS = DEV_LATENCIES.map((latency) => ({
	value: String(latency),
	label: DEV_LATENCY_LABELS[latency],
}));

export function DevCustomScenario({
	busy,
	latency,
	match,
	onApply,
	onAxisChange,
	onLatencyChange,
	scenario,
}: DevCustomScenarioProps) {
	return (
		<section
			aria-label="Custom"
			className="flex flex-col gap-3 @2xl:w-64 @2xl:shrink-0"
		>
			<h3 className="type-label">Custom</h3>
			<div className="grid grid-cols-2 gap-x-2 gap-y-3">
				{DEV_AXES.map((axis) => (
					<DevAxisSelect
						axis={axis}
						key={axis}
						onChange={onAxisChange}
						scenario={scenario}
					/>
				))}
				<Field>
					<FieldLabel>Latency</FieldLabel>
					<Select
						items={LATENCY_ITEMS}
						onValueChange={(value) => {
							const next = DEV_LATENCIES.find(
								(option) => String(option) === value,
							);
							if (next !== undefined) {
								onLatencyChange(next);
							}
						}}
						value={String(latency)}
					>
						<SelectTrigger size="sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent size="sm">
							{LATENCY_ITEMS.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
			</div>
			<div className="flex items-center justify-end gap-3">
				{match ? (
					<p className="min-w-0 truncate type-caption text-text-2">
						Same as {match.label}
					</p>
				) : null}
				<Button
					disabled={busy !== null && busy !== DEV_CUSTOM_KEY}
					onClick={onApply}
					pending={busy === DEV_CUSTOM_KEY}
					size="sm"
				>
					Apply
				</Button>
			</div>
		</section>
	);
}
