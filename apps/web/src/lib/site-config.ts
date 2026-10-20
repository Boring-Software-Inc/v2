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
		"Tripwire is a contribution gatekeeper for git forges. It checks contributors and change requests against rules you set, blocks slop before it merges, and keeps a record of every verdict.",
};
