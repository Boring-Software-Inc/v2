import type {
	OnboardingIntent,
	OnboardingReferral,
	OnboardingRole,
	OnboardingRulePickId,
	OnboardingTeamSize,
	OnboardingUsage,
} from "@tripwire/contracts";

/** Onboarding copy, verbatim from the approved design and Echo. */
export const ONBOARDING_COPY = {
	skipSetup: "Skip setup",
	progressNav: "Onboarding steps",
	continue: "Continue",
	skip: "Skip",
	saveFailed: "Could not save. Try again.",
	finishFailed: "Could not finish setup.",
	loadingPreview: "Updating preview",
	skipConfirm: {
		title: "Skip for now?",
		body: "You can set this up from the repo later. The rest of onboarding will be skipped.",
		action: "Skip",
	},
	welcome: { lead: "welcome to" },
	problems: {
		title: "What's getting through?",
		sub: "Select all that have ever been an issue in your repos. Tripwire will select rules that match.",
		selected: (count: number) => `${count} selected`,
	},
	about: {
		title: "About you",
		sub: "Tripwire will use this to figure out how strict to start.",
		usage: "How will you use Tripwire?",
		role: "What's your role?",
		teamSize: "How big is your team?",
		referral: "How did you hear about us?",
		optional: "Optional",
	},
	workspace: {
		title: "Name your workspace",
		sub: "This is where your repos, rules and reviewers will live. You can change this any time.",
		name: "Workspace name",
		avatarNote:
			"The avatar is generated from the name, change the name to reroll.",
		slug: "Slug",
		slugPrefix: "app.tripwire.sh/",
		available: "Available",
		livesAt: (slug: string) => `Your workspace lives at /${slug}`,
		slugTaken: "That name is taken.",
		slugInvalid: "Use 3 to 32 lowercase letters, numbers or dashes.",
		create: "Create workspace",
		createFailed: "Could not create the workspace. Try again.",
	},
	connect: {
		title: "Connect your forge",
		sub: "Tripwire will install itself as an app. Select the repos you want it to watch.",
		installedSub: (forgeApp: string) =>
			`The ${forgeApp} is installed. Pick the repos Tripwire should watch.`,
		forges: {
			github: {
				name: "GitHub",
				app: "GitHub App",
				action: "Install GitHub App",
			},
			gitcafe: {
				name: "GitCafe",
				app: "GitCafe app",
				action: "Install GitCafe app",
			},
		},
		installOn: (forge: string) => `Install on ${forge}`,
		waitingTitle: (forge: string) => `Waiting on ${forge}`,
		waitingBody: "Finish installing the app in the other tab.",
		waitingLong: (forge: string) =>
			`Still waiting on ${forge}. Keep this tab open. You can reopen ${forge}.`,
		openForge: (forge: string) => `Open ${forge}`,
		unavailable: (forgeApp: string) =>
			`The ${forgeApp} is not configured on this server.`,
		reposLabel: "Repos to watch",
		readingTitle: "Reading your repos",
		readingBody: (org: string) =>
			`Finding the repos the app can see in ${org}.`,
		findRepo: "Find a repo",
		reposCount: (picked: number, total: number) => `${picked} of ${total}`,
		privateTag: "Private",
		reposEmptyTitle: "No repos yet",
		reposEmptyBody: (forgeApp: string) =>
			`The ${forgeApp} is installed. Wait for the repos to come through.`,
		reposSearchEmpty: (query: string) => `No repos match ${query}.`,
		watch: (count: number) =>
			count === 0
				? "Pick a repo"
				: count === 1
					? "Watch this repo"
					: `Watch ${count} repos`,
	},
	rules: {
		title: "Pick your rules",
		sub: "These are the ones we recommend, based on what you told us. New rules block change requests that don't pass. Nothing gets closed unless a workflow says so.",
		forYourPicks: "For your picks",
		optional: "Optional",
		pickFor: (intent: string) => `For ${intent}`,
		install: (count: number) =>
			count === 0 ? "Continue" : `Install ${count} rules`,
		loading: "Loading rules",
	},
	check: {
		title: "Show Tripwire one that got through",
		sub: "Pick the change requests that should not have. Tripwire drafts a workflow from them.",
		searchPlaceholder: "Search by title or number",
		searchEmpty: (query: string) => `No change requests match ${query}.`,
		noneTitle: "Nothing to check yet",
		noneBody:
			"There are no change requests to check yet. This will be skipped for now.",
		add: "Add",
		running: "Reading it",
		queued: "Queued",
		failed: (count: number) => `${count} rules did not pass`,
		passed: "All passed",
		cooldown: "Re-run moments ago. Try shortly.",
		error: "Could not start the re-run.",
		background:
			"This runs in the background. Keep going. The draft will be here later.",
		skipForNow: "Skip for now",
	},
	responses: {
		title: "Pick what Tripwire posts",
		sub: "Tripwire comments on the change requests it stops. You choose where it speaks and where it stays quiet.",
		label: "Post a comment when it",
		block: { name: "Block", desc: "Fails it and requests changes" },
		review: { name: "Human review", desc: "Sends it to human review" },
		close: { name: "Close", desc: "Closes it via a workflow" },
		fixTitle: "Show how to fix it",
		fixDesc: "Adds an expandable fix guide",
		note: (forge: string) =>
			`The ${forge} check always posts, except on a pass.`,
		keepDefaults: "Keep defaults",
	},
	workflow: {
		title: "Tripwire built a workflow for you",
		sub: "Tripwire built this workflow from the change requests you reported. Save it and it will catch the next ones like them.",
		builtFrom: "Built from",
		runsOn: (repo: string) =>
			`It will run on every new change request in ${repo}. You can change it later.`,
		notNow: "Not now",
		save: "Save it",
		saved: "Saved and turned on.",
		saveFailed: "Could not save the workflow.",
		draftingTitle: "Drafting a workflow",
		draftingSub: "Tripwire is reading the change requests you reported.",
		nothingTitle: "Nothing to draft",
		nothingBody:
			"No rules failed on the change requests you reported. There's nothing to draft.",
	},
	agents: {
		title: "Use Tripwire with your coding agent",
		sub: "Check the queue, tune rules and push workflows from where you already work.",
		copy: "Copy",
		copied: "Copied",
		add: "Add",
		show: "Show",
		hide: "Hide",
		more: (count: number) => `Copilot, Gemini, Zed and ${count} more`,
		terminal: "Or install it in your terminal",
		otherClients: "Use mcp.tripwire.sh/mcp for other clients",
		goTo: (repo: string) => `Go to ${repo}`,
		done: "Finish setup",
	},
} as const;

export const INTENT_COPY = {
	"drive-by-slop": {
		name: "Drive-by slop",
		desc: "AI generated churn, vanity refactors",
	},
	"new-accounts": {
		name: "Brand new accounts",
		desc: "Throwaway accounts with no history",
	},
	floods: { name: "Floods", desc: "10 change requests an hour" },
	"crypto-spam": {
		name: "Crypto spam",
		desc: "Wallet addresses in titles and diffs",
	},
	"workflow-tampering": {
		name: "Workflow tampering",
		desc: "Changes to .github/workflows",
	},
	"mass-changes": { name: "Mass changes", desc: "200 file drive bys" },
	"off-language": {
		name: "Off language spam",
		desc: "Noise in other scripting languages",
	},
	"not-sure": { name: "Not sure yet", desc: "Just start with the basics" },
} satisfies Record<OnboardingIntent, { name: string; desc: string }>;

export const USAGE_COPY = {
	team: "With my team",
	personal: "For myself",
} satisfies Record<OnboardingUsage, string>;

export const ROLE_COPY = {
	maintainer: "Maintainer",
	founder: "Founder",
	"engineering-lead": "Engineering lead",
	security: "Security",
	devrel: "DevRel",
	other: "Other",
} satisfies Record<OnboardingRole, string>;

export const TEAM_SIZE_COPY = {
	solo: "Just me",
	"2-10": "2–10",
	"11-50": "11–50",
	"51-200": "51–200",
	"200-plus": "200+",
} satisfies Record<OnboardingTeamSize, string>;

export const REFERRAL_COPY = {
	x: "X.com",
	github: "GitHub",
	"hacker-news": "Hacker News",
	reddit: "Reddit",
	bluesky: "Bluesky",
	youtube: "YouTube",
	discord: "Discord",
	linkedin: "LinkedIn",
	friend: "A friend",
} satisfies Record<OnboardingReferral, string>;

/** The rule picks on the `rules` step, as the design names them. */
export const PICK_COPY = {
	"spam-protection": {
		name: "Spam protection",
		desc: "Account age 7 days, rate limit 5 a day, English only",
	},
	"crypto-scams": {
		name: "Crypto scams",
		desc: "Crypto address, honeypot paths",
	},
	"ai-review": {
		name: "AI review",
		desc: "Reads the change like a reviewer and blocks slop",
	},
	"first-time-contributors": {
		name: "First-time contributors",
		desc: "Merged change requests, profile README",
	},
	"bulk-changes": { name: "Bulk changes", desc: "Max 200 files changed" },
} satisfies Record<OnboardingRulePickId, { name: string; desc: string }>;
