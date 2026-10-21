import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { NotFoundBody } from "#/components/not-found";

export function NotFoundInShell() {
	return (
		<DashboardLayout counts={{}} nav={false}>
			<div className="flex min-h-full items-center justify-center px-4 py-10">
				<NotFoundBody signedIn />
			</div>
		</DashboardLayout>
	);
}
