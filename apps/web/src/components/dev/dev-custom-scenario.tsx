import { DEV_CUSTOM_KEY } from "#/components/dev/use-dev-actions";
import { Button } from "#/components/glaze/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
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
	type DevScenario,
} from "#/lib/dev/scenarios";

const LABEL_CLASS = "w-20 flex-none type-caption text-text-2";

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
		<Field orientation="horizontal">
			<FieldLabel className={LABEL_CLASS}>{DEV_AXIS_LABELS[axis]}</FieldLabel>
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
				<SelectTrigger className="min-w-0 flex-1" size="sm">
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
		<Collapsible
			className="shrink-0 border-t border-line-faint p-1"
			onKeyDown={(event) => event.stopPropagation()}
		>
			<CollapsibleTrigger className="w-full self-stretch" size="sm">
				Custom
			</CollapsibleTrigger>
			<CollapsibleContent className="flex flex-col gap-1.5 px-2 pt-1 pb-1.5">
				{DEV_AXES.map((axis) => (
					<DevAxisSelect
						axis={axis}
						key={axis}
						onChange={onAxisChange}
						scenario={scenario}
					/>
				))}
				<Field orientation="horizontal">
					<FieldLabel className={LABEL_CLASS}>Latency</FieldLabel>
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
						<SelectTrigger className="min-w-0 flex-1" size="sm">
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
				<Button
					className="self-end"
					disabled={busy !== null && busy !== DEV_CUSTOM_KEY}
					onClick={onApply}
					pending={busy === DEV_CUSTOM_KEY}
					size="sm"
					variant="secondary"
				>
					Apply
				</Button>
			</CollapsibleContent>
		</Collapsible>
	);
}
