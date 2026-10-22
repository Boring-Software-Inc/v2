import type { Ref } from "react";
import { DevCustomScenario } from "#/components/dev/dev-custom-scenario";
import { DevIdentity } from "#/components/dev/dev-identity";
import { DevPresetList } from "#/components/dev/dev-preset-list";
import { useDevActions } from "#/components/dev/use-dev-actions";
import { useDevScenario } from "#/components/dev/use-dev-scenario";
import { toast } from "#/components/glaze/ui/toast";
import { appliedLabel } from "#/lib/dev/scenario-panel";
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
		<div className={cn("@container flex flex-col gap-4", className)}>
			<DevIdentity
				busy={actions.busy}
				current={dev.applied ? appliedLabel(dev.applied) : null}
				onLogout={() => actions.logout()}
				onReset={() => actions.reset()}
			/>
			<div className="flex flex-col gap-4 @2xl:flex-row @2xl:items-start">
				<DevPresetList
					busy={actions.busy}
					currentId={dev.applied?.presetId ?? null}
					matchId={dev.match?.id ?? null}
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
					match={dev.match}
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
			</div>
		</div>
	);
}
