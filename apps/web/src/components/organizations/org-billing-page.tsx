import { useFeedback } from "#/components/feedback";
import { MascotArt } from "#/components/mascot/mascot-art";
import { SettingsHeader } from "#/components/settings/settings-frame";
import { Button } from "#/design-system/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/design-system/ui/empty-state";

export function OrgBillingPage() {
	const { start: openFeedback } = useFeedback();
	return (
		<>
			<SettingsHeader title="Billing" />
			<Empty art={<MascotArt mood="billing-empty" />} variant="plain">
				<EmptyHeader>
					<EmptyTitle>Tripwire is free for now</EmptyTitle>
					<EmptyDescription>
						Use Tripwire without a paid plan while we work out pricing.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={openFeedback} size="sm" variant="secondary">
						Help shape pricing
					</Button>
				</EmptyContent>
			</Empty>
		</>
	);
}
