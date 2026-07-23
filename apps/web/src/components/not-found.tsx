import { Link } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";

export function NotFound() {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
			<p className="font-semibold text-5xl tracking-tight tabular-nums">404</p>
			<div className="flex flex-col gap-1.5">
				<h1 className="font-semibold text-xl tracking-tight">Page not found</h1>
				<p className="max-w-sm text-muted-foreground text-sm">
					That page doesn’t exist or may have moved. Check the URL, or head back
					to the queue.
				</p>
			</div>
			<Button
				className="mt-1"
				nativeButton={false}
				render={<Link to="/" />}
				size="sm"
				variant="outline"
			>
				Back to moderation
			</Button>
		</div>
	);
}
