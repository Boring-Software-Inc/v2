import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { MascotArt } from "#/components/mascot/mascot-art";

export function RunnerPage() {
	return (
		<main className="grid min-h-dvh place-items-center bg-page px-4 py-10 text-text-1">
			<Empty art={<MascotArt mood="activity-empty" />} className="max-w-xl">
				<EmptyHeader>
					<EmptyTitle>No activity yet</EmptyTitle>
					<EmptyDescription>
						Tripwire is watching this repo. When a change request opens, its
						timeline and verdict show up here.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</main>
	);
}
