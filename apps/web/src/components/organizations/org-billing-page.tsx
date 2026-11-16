import {
	EmptyState,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { MascotArt } from "#/components/mascot/mascot-art";
import { SettingsHeader } from "#/components/settings/settings-frame";

export function OrgBillingPage() {
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
			</EmptyState>
		</>
	);
}
