import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { currentUserQueryOptions } from "#/lib/auth.query";

function RunSkeletonBody() {
	// Mirrors RunBody: a header + a "steps" list, on the surface the shell owns.
	return (
		<div className="mx-auto w-full max-w-3xl px-6 py-8">
			<header className="mb-6">
				<div className="h-8 w-40 animate-pulse rounded-md bg-surface-1" />
				<div className="mt-2 h-4 w-64 animate-pulse rounded-md bg-surface-1" />
			</header>
			<div className="overflow-hidden rounded-xl border bg-card">
				<div className="h-9 animate-pulse bg-surface-1" />
				{Array.from({ length: 6 }, (_, i) => `run-skel-${i}`).map((key) => (
					<div className="px-4 py-3.5" key={key}>
						<div className="h-4 w-1/2 animate-pulse rounded bg-surface-1" />
					</div>
				))}
			</div>
		</div>
	);
}

export function RunPageSkeleton() {
	// The run page is dual-mode (§10): maintainers get the dashboard shell, public
	// viewers get a chromeless page. Branch the skeleton on session so neither
	// flashes the wrong frame — a signed-in maintainer's currentUser query is
	// already cached (chrome up front), a logged-out visitor resolves to null
	// (bare page, no chrome to flash away).
	const { data: user } = useQuery(currentUserQueryOptions());
	if (user) {
		return (
			<DashboardLayout counts={{}}>
				<RunSkeletonBody />
			</DashboardLayout>
		);
	}
	return (
		<div className="min-h-dvh bg-background">
			<RunSkeletonBody />
		</div>
	);
}
