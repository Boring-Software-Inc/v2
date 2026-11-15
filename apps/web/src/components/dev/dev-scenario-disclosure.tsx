import { Collapsible } from "@tripwire/ui/collapsible";
import { DevScenarioPanel } from "#/components/dev/dev-scenario-panel";

export function DevScenarioDisclosure() {
	if (!import.meta.env.DEV) {
		return null;
	}
	return (
		<div className="flex w-full flex-col items-center composition-gap-standard">
			<Collapsible trigger="Dev scenarios">
				<div className="w-88 max-w-full">
					<DevScenarioPanel />
				</div>
			</Collapsible>
		</div>
	);
}
