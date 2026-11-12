import { useLocation, useParams } from "@tanstack/react-router";

export function orgSwitchPath({
	currentOrg,
	nextOrg,
	pathname,
	search = "",
	hash = "",
}: {
	currentOrg: string | undefined;
	nextOrg: string;
	pathname: string;
	search?: string;
	hash?: string;
}): string {
	if (!currentOrg) {
		return `/${nextOrg}/home`;
	}
	const prefix = `/${currentOrg}`;
	if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
		return `/${nextOrg}/home`;
	}
	const normalizedSearch = search
		? search.startsWith("?")
			? search
			: `?${search}`
		: "";
	const normalizedHash = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
	return `${pathname.replace(prefix, `/${nextOrg}`)}${normalizedSearch}${normalizedHash}`;
}

export function useOrgSwitchPath() {
	const currentOrg = useParams({ strict: false }).org;
	const location = useLocation({
		select: (value) => ({
			hash: value.hash,
			pathname: value.pathname,
			search: value.searchStr,
		}),
	});

	return (nextOrg: string): string =>
		orgSwitchPath({ currentOrg, nextOrg, ...location });
}
