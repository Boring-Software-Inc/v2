import { Status } from "#/components/glaze/ui/status";

export function LiveIndicator({ live }: { live: boolean }) {
	return live ? (
		<Status className="shrink-0" size="sm" status="ok">
			Live
		</Status>
	) : (
		<Status className="shrink-0" size="sm" status="running">
			Connecting
		</Status>
	);
}
