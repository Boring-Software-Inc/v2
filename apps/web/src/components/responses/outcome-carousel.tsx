import { Tabs } from "@tripwire/ui/tabs";
import { OUTCOMES } from "#/components/responses/responses-model";

const LOCAL_APPEARANCE = {
	node15_1: "sticky top-0 z-(--z-raised) border-b border-line-faint bg-shell",
} as const;

export interface OutcomeCarouselProps {
	onValueChange: (value: string) => void;
	value: string;
}

export function OutcomeCarousel({
	onValueChange,
	value,
}: OutcomeCarouselProps) {
	return (
		<div
			className={LOCAL_APPEARANCE.node15_1}
			data-layout-role="response-outcome-carousel"
		>
			<Tabs
				ariaLabel="Outcome"
				items={OUTCOMES.map((option) => ({
					label: option.label,
					value: option.value,
				}))}
				onValueChange={(nextValue) => {
					if (nextValue) onValueChange(nextValue);
				}}
				panelMode="external"
				size="small"
				value={value}
			/>
		</div>
	);
}
