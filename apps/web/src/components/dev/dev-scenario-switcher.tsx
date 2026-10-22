import { useRef } from "react";
import { DevScenarioPanel } from "#/components/dev/dev-scenario-panel";
import { Button } from "#/components/glaze/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";

export function DevScenarioSwitcher() {
	const searchRef = useRef<HTMLInputElement>(null);
	if (!import.meta.env.DEV) {
		return null;
	}
	return (
		<div className="fixed bottom-3 left-3 z-(--z-overlay) max-md:top-1/2 max-md:bottom-auto max-md:-translate-y-1/2 print:hidden">
			<Popover>
				<PopoverTrigger render={<Button size="sm" variant="secondary" />}>
					Dev
				</PopoverTrigger>
				<PopoverContent
					align="start"
					className="max-h-[min(32rem,var(--available-height))] w-88 gap-0 p-0"
					initialFocus={searchRef}
					side="top"
				>
					<DevScenarioPanel searchRef={searchRef} />
				</PopoverContent>
			</Popover>
		</div>
	);
}
