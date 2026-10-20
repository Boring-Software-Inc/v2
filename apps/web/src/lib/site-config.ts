type SiteConfig = {
	name: string;
	wordmark: string;
	tagline: string;
	themeColor: string;
	githubRepositoryUrl: string;
	defaultTitle: string;
	defaultDescription: string;
};

export const siteConfig: SiteConfig = {
	name: "Tripwire",
	wordmark: "tripwire",
	tagline: "The firewall for your OSS projects",
	themeColor: "#fbfbfa",
	githubRepositoryUrl: "https://github.com/Boring-Software-Inc/tripwire",
	defaultTitle: "Tripwire | Open source firewall for git",
	defaultDescription:
		"Tripwire is a contribution gatekeeper for git forges. It checks contributors and change requests against rules you set, blocks slop before it merges, and keeps a record of every verdict.",
};
