import { useLocation } from "@tanstack/react-router";

export function useFeaturePath(
	org: string | undefined,
	repo: string | undefined,
): string {
	const pathname = useLocation({ select: (location) => location.pathname });
	if (!org || !repo) {
		return "";
	}
	const prefix = `/${org}/${repo}/`;
	if (!pathname.startsWith(prefix)) {
		return "";
	}
	const segment = pathname.slice(prefix.length).split("/")[0];
	return segment ? `/${segment}` : "";
}
