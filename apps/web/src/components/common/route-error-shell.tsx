import { RouteErrorBody } from "#/components/common/route-error";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export function RouteErrorInShell({
	onRetry,
}: {
	onRetry: () => Promise<void>;
}) {
	return (
		<DashboardLayout counts={{}} nav={false}>
			<div className="flex min-h-full items-center justify-center px-4 py-10">
				<RouteErrorBody onRetry={onRetry} signedIn />
			</div>
		</DashboardLayout>
	);
}
