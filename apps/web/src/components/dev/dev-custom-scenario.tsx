import { Button } from "@tripwire/ui/button";
import { Collapsible } from "@tripwire/ui/collapsible";
import { Field, FieldLabel } from "@tripwire/ui/field";
import { Select, type SelectOption } from "@tripwire/ui/select";
import { DEV_CUSTOM_KEY } from "#/components/dev/use-dev-actions";
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
	type DevScenario,
} from "#/lib/dev/scenarios";

const LABEL_CLASS = "w-20 flex-none content-caption tone-content-secondary";

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
	const items: SelectOption<DevScenario[A]>[] = options.map((option) => ({
		value: option,
		label: labels[option],
		description: blockedReason(scenario, axis, option) ?? undefined,
		disabled: blockedReason(scenario, axis, option) !== null,
	}));
	return (
		<Field orientation="horizontal">
			<span className={LABEL_CLASS}>
				<FieldLabel>{DEV_AXIS_LABELS[axis]}</FieldLabel>
			</span>
			<span className="min-w-0 flex-1">
				<Select
					ariaLabel={DEV_AXIS_LABELS[axis]}
					options={items}
					onValueChange={(next) => {
						if (next !== null) {
							onChange(axis, next);
						}
					}}
					value={scenario[axis]}
				/>
			</span>
		</Field>
	);
}

interface DevCustomScenarioProps {
	busy: string | null;
	latency: DevLatency;
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
	onApply,
	onAxisChange,
	onLatencyChange,
	scenario,
}: DevCustomScenarioProps) {
	return (
		<div className="shrink-0 border-t tone-border-faint composition-inset-small">
			<div>
				<Collapsible trigger="Custom">
					<div data-layout-role="dev-custom-scenario-fields">
						{DEV_AXES.map((axis) => (
							<DevAxisSelect
								axis={axis}
								key={axis}
								onChange={onAxisChange}
								scenario={scenario}
							/>
						))}
						<Field orientation="horizontal">
							<span className={LABEL_CLASS}>
								<FieldLabel>Latency</FieldLabel>
							</span>
							<span className="min-w-0 flex-1">
								<Select
									ariaLabel="Latency"
									options={LATENCY_ITEMS}
									onValueChange={(value) => {
										const next = DEV_LATENCIES.find(
											(option) => String(option) === value,
										);
										if (next !== undefined) {
											onLatencyChange(next);
										}
									}}
									value={String(latency)}
								/>
							</span>
						</Field>
						<div className="flex justify-end">
							<Button
								disabled={busy !== null && busy !== DEV_CUSTOM_KEY}
								onAction={onApply}
								pending={busy === DEV_CUSTOM_KEY}
								size="small"
								variant="secondary"
							>
								Apply
							</Button>
						</div>
					</div>
				</Collapsible>
			</div>
		</div>
	);
}
