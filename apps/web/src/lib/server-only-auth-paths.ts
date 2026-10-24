const SERVER_ONLY_AUTH_PATHS = [
	"/api/auth/staff/",
	"/api/auth/admin/impersonate-user",
	"/api/auth/admin/stop-impersonating",
] as const;

export function isServerOnlyAuthPath(pathname: string): boolean {
	const path = pathname.toLowerCase();
	return SERVER_ONLY_AUTH_PATHS.some((prefix) => path.startsWith(prefix));
}
