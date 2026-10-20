import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { sessionInfoQueryOptions } from "#/lib/auth.query";

const NotFoundInShell = lazy(() =>
	import("#/components/not-found-shell").then((m) => ({
		default: m.NotFoundInShell,
	})),
);

export function NotFoundBody({ signedIn }: { signedIn: boolean }) {
	return (
		<Empty className="max-w-sm" reason="no-results">
			<EmptyHeader>
				<EmptyTitle>Page not found</EmptyTitle>
				<EmptyDescription>
					That page does not exist or may have moved. Check the URL.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button nativeButton={false} render={<Link to="/" />} size="sm">
					{signedIn ? "Go to dashboard" : "Go to sign in"}
				</Button>
			</EmptyContent>
		</Empty>
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
