/** Short absolute date for admin tables ("12 Mar 2026"). */
export function formatAdminDate(value: Date | string): string {
	return new Date(value).toLocaleDateString("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}
