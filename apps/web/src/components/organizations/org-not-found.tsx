import { Link } from "@tanstack/react-router";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";

/**
 * §8 — a non-member sees a 404, never a 403. This screen carries NO hint
 * that an org exists behind the slug; it's the same page for a typo and a
 * real org you're not in.
 */
export function OrgNotFound() {
	return (
		<main className="flex min-h-dvh items-center justify-center bg-page px-4 py-10">
			<Empty className="max-w-sm" reason="no-results">
				<EmptyHeader>
					<EmptyTitle>Not found</EmptyTitle>
					<EmptyDescription>This page doesn't exist.</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button
						nativeButton={false}
						render={<Link to="/" />}
						size="sm"
						variant="secondary"
					>
						Go home
					</Button>
				</EmptyContent>
			</Empty>
		</main>
	);
}
