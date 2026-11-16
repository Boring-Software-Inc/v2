import { useQuery } from "@tanstack/react-query";
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { ActionLink } from "@tripwire/ui/button";
import { type ComponentProps, lazy, Suspense } from "react";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateRetry,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { MascotArt } from "#/components/mascot/mascot-art";
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
		<EmptyState
			art={<MascotArt mood="route-error" />}
			className="max-w-sm"
			reason="error"
		>
			<EmptyStateHeader>
				<EmptyStateTitle>This page didn't load</EmptyStateTitle>
				<EmptyStateDescription>
					{reload && "Reload this page to get the latest version."}
					{!reload &&
						(signedIn
							? "Something broke on our side. Try again, or go back to your home page."
							: "Something broke on our side. Try again, or sign in.")}
				</EmptyStateDescription>
			</EmptyStateHeader>
			<EmptyStateContent className="flex flex-wrap items-start justify-center composition-gap-standard">
				<EmptyStateRetry onRetry={onRetry} size="small" variant="primary">
					{reload ? "Reload page" : "Try again"}
				</EmptyStateRetry>
				<ActionLink href="/" size="small" variant="primary">
					{signedIn ? "Go to home" : "Sign in"}
				</ActionLink>
			</EmptyStateContent>
		</EmptyState>
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
