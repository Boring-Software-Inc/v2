import type { Ref } from "react";
import { DevCustomScenario } from "#/components/dev/dev-custom-scenario";
import { DevIdentity } from "#/components/dev/dev-identity";
import { DevPresetList } from "#/components/dev/dev-preset-list";
import { useDevActions } from "#/components/dev/use-dev-actions";
import { useDevScenario } from "#/components/dev/use-dev-scenario";
import { Command } from "#/components/glaze/ui/command";
import { toast } from "#/components/glaze/ui/toast";
import { DEV_LATENCY_LABELS, type DevLatency } from "#/lib/dev/scenarios";
import { cn } from "#/lib/glaze/utils";

interface DevScenarioPanelProps {
	className?: string;
	searchRef?: Ref<HTMLInputElement>;
}

export function DevScenarioPanel({
	className,
	searchRef,
}: DevScenarioPanelProps) {
	const dev = useDevScenario();
	const actions = useDevActions(dev.commit);

	async function changeLatency(latency: DevLatency): Promise<void> {
		await dev.setLatency(latency);
		toast(`Latency ${DEV_LATENCY_LABELS[latency]}`, {
			action: { label: "Reload", onClick: () => window.location.reload() },
		});
	}

	return (
		<Command
			className={cn("min-h-0", className)}
			label="Dev scenarios"
			shouldFilter={false}
		>
			<DevPresetList
				busy={actions.busy}
				currentId={dev.applied?.presetId ?? null}
				onApply={(preset) =>
					actions.apply({
						presetId: preset.id,
						scenario: preset.scenario,
						latency: preset.latency,
					})
				}
				searchRef={searchRef}
			/>
			<DevCustomScenario
				busy={actions.busy}
				latency={dev.latency}
				onApply={() =>
					actions.apply({
						presetId: dev.match?.id ?? null,
						scenario: dev.scenario,
						latency: dev.latency,
					})
				}
				onAxisChange={dev.setAxis}
				onLatencyChange={changeLatency}
				scenario={dev.scenario}
			/>
			<DevIdentity
				busy={actions.busy}
				onLogout={() => actions.logout()}
				onReset={() => actions.reset()}
			/>
		</Command>
	);
}
