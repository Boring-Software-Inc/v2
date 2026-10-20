import { Link } from "@tanstack/react-router";
import { Button } from "#/components/glaze/ui/button";

export function NotFound() {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-page px-4 text-center text-text-1">
			<div className="flex flex-col items-center gap-1">
				<h1 className="type-title">Page not found</h1>
				<p className="max-w-measure-hint type-body text-text-2">
					That page does not exist or may have moved. Check the URL, or head
					back to the queue.
				</p>
			</div>
			<Button nativeButton={false} render={<Link to="/" />} size="sm">
				Back to moderation
			</Button>
		</main>
	);
}
