import {
	EmptyState as EmptyStatePrimitive,
	type EmptyStateProps,
} from "@tripwire/ui/empty-state";
import { MascotArt } from "#/components/mascot/mascot-art";
import "./empty-state.css";

export {
	EmptyStateArt,
	EmptyStateCode,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateRetry,
	EmptyStateTitle,
} from "@tripwire/ui/empty-state";

/** Tripwire product empty state with the interactive ghost as its default art. */
export function EmptyState({
	art,
	size = "default",
	...props
}: EmptyStateProps) {
	return (
		<EmptyStatePrimitive
			art={
				art === undefined ? (
					<MascotArt
						mood="empty"
						size={size === "sm" ? "compact" : "default"}
					/>
				) : (
					art
				)
			}
			size={size}
			{...props}
		/>
	);
}
