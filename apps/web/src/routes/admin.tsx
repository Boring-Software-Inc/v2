import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { getAdminContext } from "#/lib/admin.functions";

/**
 * Platform staff layout — resolves the staff bit BEFORE render. A non-staff
 * caller (or no session) is a 404, never a 403: /admin's existence is not
 * disclosed, the same posture as non-member org URLs. Route gating is UX;
 * the real boundary is platformAdminMiddleware on every admin server fn.
 */
export const Route = createFileRoute("/admin")({
	beforeLoad: async () => {
		try {
			await getAdminContext();
		} catch {
			throw notFound();
		}
	},
	component: () => <Outlet />,
});
