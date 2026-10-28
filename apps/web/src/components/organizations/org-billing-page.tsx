import { useFeedback } from "#/components/feedback";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { MascotArt } from "#/components/mascot/mascot-art";
import { SettingsHeader } from "#/components/settings/settings-frame";

export function OrgBillingPage() {
	const { start: openFeedback } = useFeedback();
	return (
		<>
			<SettingsHeader title="Billing" />
			<Empty art={<MascotArt mood="billing-empty" />} variant="plain">
				<EmptyHeader>
					<EmptyTitle>No billing yet</EmptyTitle>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={openFeedback} size="sm" variant="secondary">
						Send feedback on billing
					</Button>
				</EmptyContent>
			</Empty>
		</>
	);
}
