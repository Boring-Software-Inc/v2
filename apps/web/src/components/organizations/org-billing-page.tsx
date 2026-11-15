import { Button } from "@tripwire/ui/button";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { useFeedback } from "#/components/feedback";
import { MascotArt } from "#/components/mascot/mascot-art";
import { SettingsHeader } from "#/components/settings/settings-frame";

export function OrgBillingPage() {
	const { start: openFeedback } = useFeedback();
	return (
		<>
			<SettingsHeader title="Billing" />
			<EmptyState
				art={
					<MascotArt className="billing-mascot-spacing" mood="billing-empty" />
				}
				variant="plain"
			>
				<EmptyStateHeader className="flex max-w-80 flex-col items-center composition-gap-small">
					<EmptyStateTitle headingLevel={2}>
						Tripwire is free for now
					</EmptyStateTitle>
					<EmptyStateDescription className="text-pretty">
						Use Tripwire without a paid plan while we work out pricing.
					</EmptyStateDescription>
				</EmptyStateHeader>
				<EmptyStateContent>
					<Button onAction={openFeedback} size="small" variant="secondary">
						Help shape pricing
					</Button>
				</EmptyStateContent>
			</EmptyState>
		</>
	);
}
