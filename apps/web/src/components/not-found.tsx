import { useQuery } from "@tanstack/react-query";
import { ActionLink } from "@tripwire/ui/button";
import { lazy, Suspense } from "react";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { MascotArt } from "#/components/mascot/mascot-art";
import { sessionInfoQueryOptions } from "#/lib/auth.query";

const NotFoundInShell = lazy(() =>
	import("#/components/not-found-shell").then((m) => ({
		default: m.NotFoundInShell,
	})),
);

export function NotFoundBody({ signedIn }: { signedIn: boolean }) {
	return (
		<EmptyState
			art={<MascotArt mood="not-found" />}
			className="max-w-sm"
			data-layout-role="public-empty-state"
			reason="no-results"
		>
			<EmptyStateHeader>
				<EmptyStateTitle>Page not found</EmptyStateTitle>
				<EmptyStateDescription>
					Nothing is at this address. Check the link, or go back to your home
					page.
				</EmptyStateDescription>
			</EmptyStateHeader>
			<EmptyStateContent>
				<ActionLink href="/" size="small" variant="primary">
					{signedIn ? "Go to home" : "Sign in"}
				</ActionLink>
			</EmptyStateContent>
		</EmptyState>
	);
}

export function NotFound() {
	const { data: session } = useQuery(sessionInfoQueryOptions());
	if (session?.user) {
		return (
			<Suspense fallback={null}>
				<NotFoundInShell />
			</Suspense>
		);
	}
	return (
		<main className="flex min-h-dvh items-center justify-center bg-page px-4 py-10">
			<NotFoundBody signedIn={false} />
		</main>
	);
}
