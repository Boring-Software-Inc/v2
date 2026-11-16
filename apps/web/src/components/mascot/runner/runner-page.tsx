import {
	EmptyState,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { MascotArt } from "#/components/mascot/mascot-art";

export function RunnerPage() {
	return (
		<main className="grid min-h-dvh place-items-center bg-page px-4 py-10 text-text-1">
			<EmptyState
				art={<MascotArt mood="activity-empty" />}
				className="max-w-xl"
				data-layout-role="public-empty-state"
			>
				<EmptyStateHeader>
					<EmptyStateTitle>No activity yet</EmptyStateTitle>
					<EmptyStateDescription>
						Tripwire is watching this repo. When a change request opens, its
						timeline and verdict show up here.
					</EmptyStateDescription>
				</EmptyStateHeader>
			</EmptyState>
		</main>
	);
}
