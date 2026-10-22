import { DevScenarioPanel } from "#/components/dev/dev-scenario-panel";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";

export function DevScenarioDisclosure() {
	if (!import.meta.env.DEV) {
		return null;
	}
	return (
		<Collapsible className="flex w-full flex-col items-center gap-2">
			<CollapsibleTrigger size="sm">Dev scenarios</CollapsibleTrigger>
			<CollapsibleContent className="panel w-full p-3">
				<DevScenarioPanel />
			</CollapsibleContent>
		</Collapsible>
	);
}
