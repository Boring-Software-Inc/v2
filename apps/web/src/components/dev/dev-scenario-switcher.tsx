import { Button } from "@tripwire/ui/button";
import { Popover } from "@tripwire/ui/popover";
import { useRef } from "react";
import { DevScenarioPanel } from "#/components/dev/dev-scenario-panel";

export function DevScenarioSwitcher() {
	const searchRef = useRef<HTMLInputElement>(null);
	if (!import.meta.env.DEV) {
		return null;
	}
	return (
		<div className="fixed bottom-3 left-3 z-(--z-overlay) max-md:top-1/2 max-md:bottom-auto max-md:-translate-y-1/2 print:hidden">
			<Popover
				align="start"
				initialFocus="first-field"
				placement="top"
				trigger={
					<Button size="small" variant="secondary">
						Dev
					</Button>
				}
				triggerLabel="Open development scenarios"
			>
				<div
					className="scenario-menu-height"
					data-layout-role="dev-scenario-picker"
				>
					<DevScenarioPanel searchRef={searchRef} />
				</div>
			</Popover>
		</div>
	);
}
