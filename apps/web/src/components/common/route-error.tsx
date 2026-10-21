import { useQuery } from "@tanstack/react-query";
import {
	type ErrorComponentProps,
	Link,
	useRouter,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyRetry,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { MascotArt } from "#/components/mascot/mascot-art";
import { sessionInfoQueryOptions } from "#/lib/auth.query";

const RouteErrorInShell = lazy(() =>
	import("#/components/common/route-error-shell").then((m) => ({
		default: m.RouteErrorInShell,
	})),
);

export function RouteErrorBody({
	signedIn,
	onRetry,
}: {
	signedIn: boolean;
	onRetry: () => Promise<void>;
}) {
	return (
		<Empty
			art={<MascotArt mood="route-error" />}
			className="max-w-sm"
			reason="error"
		>
			<EmptyHeader>
				<EmptyTitle>This page didn't load</EmptyTitle>
				<EmptyDescription>
					{signedIn
						? "Something broke on our side. Try again, or go back to your home page."
						: "Something broke on our side. Try again, or sign in."}
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<EmptyRetry onRetry={onRetry} variant="primary">
					Try again
				</EmptyRetry>
				<Button
					nativeButton={false}
					render={<Link to="/" />}
					size="sm"
					variant="secondary"
				>
					{signedIn ? "Go to home" : "Sign in"}
				</Button>
			</EmptyContent>
		</Empty>
	);
}

export function RouteError({ reset }: ErrorComponentProps) {
	const router = useRouter();
	const { data: session } = useQuery(sessionInfoQueryOptions());
	const onRetry = async () => {
		reset();
		await router.invalidate();
	};

	if (session?.user) {
		return (
			<Suspense fallback={null}>
				<RouteErrorInShell onRetry={onRetry} />
			</Suspense>
		);
	}
	return (
		<main className="flex min-h-dvh items-center justify-center bg-page px-4 py-10">
			<RouteErrorBody onRetry={onRetry} signedIn={false} />
		</main>
	);
}
