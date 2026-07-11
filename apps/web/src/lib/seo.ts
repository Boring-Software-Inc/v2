import { siteConfig } from "#/lib/site-config";

/**
 * SEO helpers (§9) — every route calls `buildSeo` in `head()`. Greenfield
 * starts on `buildSeo` only; no back-compat shims.
 */

export const PRIVATE_ROUTE_HEADERS = [
	{ name: "robots", content: "noindex, nofollow" },
];

export function toAbsoluteUrl(path: string): string {
	const base = import.meta.env.VITE_SITE_URL ?? "http://localhost:3000";
	return new URL(path, base).toString();
}

export function formatPageTitle(title?: string): string {
	if (!title) {
		return siteConfig.defaultTitle;
	}
	return `${title} · ${siteConfig.name}`;
}

export function summarizeText(text: string, max = 160): string {
	const collapsed = text.replaceAll(/\s+/g, " ").trim();
	if (collapsed.length <= max) {
		return collapsed;
	}
	return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

interface BuildSeoInput {
	path: string;
	title?: string;
	description?: string;
	type?: "website" | "article" | "profile";
	/** Private/dashboard routes: noindex. */
	noindex?: boolean;
}

export function buildSeo({
	path,
	title,
	description,
	type = "website",
	noindex = false,
}: BuildSeoInput) {
	const pageTitle = title ?? siteConfig.defaultTitle;
	const pageDescription = summarizeText(
		description ?? siteConfig.defaultDescription,
	);
	const url = toAbsoluteUrl(path);
	return {
		meta: [
			{ title: pageTitle },
			{ name: "description", content: pageDescription },
			{ property: "og:title", content: pageTitle },
			{ property: "og:description", content: pageDescription },
			{ property: "og:type", content: type },
			{ property: "og:url", content: url },
			{ property: "og:site_name", content: siteConfig.name },
			{ name: "twitter:card", content: "summary" },
			...(noindex ? PRIVATE_ROUTE_HEADERS : []),
		],
		links: [{ rel: "canonical", href: url }],
	};
}

export function buildWebSiteSchema() {
	return {
		"@context": "https://schema.org",
		"@type": "WebSite",
		name: siteConfig.name,
		url: toAbsoluteUrl("/"),
		description: siteConfig.defaultDescription,
	};
}

export function buildSoftwareApplicationSchema() {
	return {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: siteConfig.name,
		applicationCategory: "DeveloperApplication",
		operatingSystem: "Web",
		url: toAbsoluteUrl("/"),
		description: siteConfig.defaultDescription,
	};
}
