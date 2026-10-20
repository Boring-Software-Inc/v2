type SiteConfig = {
	name: string;
	tagline: string;
	themeColor: string;
	githubRepositoryUrl: string;
	defaultTitle: string;
	defaultDescription: string;
};

export const siteConfig: SiteConfig = {
	name: "tripwire",
	tagline: "The firewall for your OSS projects",
	themeColor: "#fbfbfa",
	githubRepositoryUrl: "https://github.com/Boring-Software-Inc/tripwire",
	defaultTitle: "tripwire | the open source firewall for git",
	defaultDescription:
		"tripwire is a contribution gatekeeper for git forges. it evaluates contributors and change requests against composable rules, blocks slop before it lands, and keeps every verdict auditable.",
};
