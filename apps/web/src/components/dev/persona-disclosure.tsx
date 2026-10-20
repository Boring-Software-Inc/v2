import { DevPersonaPanel } from "#/components/dev/persona-switcher";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";

export function DevPersonaDisclosure() {
	return (
		<Collapsible className="mt-2 flex w-full max-w-sm flex-col gap-2">
			<CollapsibleTrigger size="sm">Dev personas</CollapsibleTrigger>
			<CollapsibleContent className="panel p-2">
				<DevPersonaPanel />
			</CollapsibleContent>
		</Collapsible>
	);
}
