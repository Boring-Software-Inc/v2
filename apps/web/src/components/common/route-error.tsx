import { useQuery } from "@tanstack/react-query";
import {
	type ErrorComponentProps,
	Link,
	useRouter,
} from "@tanstack/react-router";
import { type ComponentProps, lazy, Suspense } from "react";
import { MascotArt } from "#/components/mascot/mascot-art";
import { Button } from "#/design-system/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyRetry,
	EmptyTitle,
} from "#/design-system/ui/empty-state";
import { sessionInfoQueryOptions } from "#/lib/auth.query";

const RouteErrorInShell = lazy(() =>
	import("#/components/common/route-error-shell").then(
		(module) => ({ default: module.RouteErrorInShell }),
		() => ({ default: RouteReload }),
	),
);

export function RouteErrorBody({
	signedIn,
	onRetry,
	reload = false,
}: {
	signedIn: boolean;
	reload?: boolean;
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
					{reload && "Reload this page to get the latest version."}
					{!reload &&
						(signedIn
							? "Something broke on our side. Try again, or go back to your home page."
							: "Something broke on our side. Try again, or sign in.")}
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<EmptyRetry onRetry={onRetry} variant="primary">
					{reload ? "Reload page" : "Try again"}
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

function StandaloneRouteError(props: ComponentProps<typeof RouteErrorBody>) {
	return (
		<main data-layout-role="standalone-route-error">
			<RouteErrorBody {...props} />
		</main>
	);
}

function RouteReload() {
	return (
		<StandaloneRouteError
			onRetry={async () => window.location.reload()}
			reload
			signedIn
		/>
	);
}

export function RouteError({ error, reset }: ErrorComponentProps) {
	const router = useRouter();
	const { data: session } = useQuery(sessionInfoQueryOptions());
	const onRetry = async () => {
		reset();
		await router.invalidate();
	};

	if (
		/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
			error.message,
		)
	) {
		return <RouteReload />;
	}

	if (session?.user) {
		return (
			<Suspense fallback={null}>
				<RouteErrorInShell onRetry={onRetry} />
			</Suspense>
		);
	}
	return <StandaloneRouteError onRetry={onRetry} signedIn={false} />;
}
