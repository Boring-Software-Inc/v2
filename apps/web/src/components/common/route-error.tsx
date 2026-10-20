import {
	type ErrorComponentProps,
	Link,
	useRouter,
} from "@tanstack/react-router";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyRetry,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";

export function RouteError({ reset }: ErrorComponentProps) {
	const router = useRouter();
	return (
		<main className="flex min-h-full w-full items-center justify-center bg-page px-4 py-10">
			<Empty className="max-w-sm" reason="error">
				<EmptyHeader>
					<EmptyTitle>This page didn't load</EmptyTitle>
					<EmptyDescription>
						Tripwire hit an error while loading this page. Try again. If it
						keeps happening, go back to your home page and send feedback.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<EmptyRetry
						onRetry={async () => {
							reset();
							await router.invalidate();
						}}
					>
						Try again
					</EmptyRetry>
					<Button
						nativeButton={false}
						render={<Link to="/" />}
						size="sm"
						variant="secondary"
					>
						Go to home
					</Button>
				</EmptyContent>
			</Empty>
		</main>
	);
}
