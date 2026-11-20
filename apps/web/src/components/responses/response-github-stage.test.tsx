import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ContributorCommentPreview,
	DeploymentPreview,
	entersCaptureRange,
	GithubChecksPreview,
	MergePreview,
	PullRequestHeader,
	PullRequestNavigation,
} from "#/components/responses/response-github-stage";

describe("GitHub response preview chrome", () => {
	test("keeps the pull request identity around Tripwire's output", () => {
		const html = renderToStaticMarkup(<PullRequestHeader forge="github" />);

		expect(html).toContain("[ShanaBoo] test bounty");
		expect(html).toContain("#231");
		expect(html).toContain("genesisrevelationinc-debug");
		expect(html).toContain("shanaboo-fix-188");
	});

	test("keeps Conversation and Checks interactive", () => {
		const html = renderToStaticMarkup(<PullRequestNavigation />);

		expect(html.match(/role="tab"/g)).toHaveLength(2);
		expect(html).toContain("Conversation");
		expect(html).toContain("Checks");
		expect(html.indexOf("Conversation")).toBeLessThan(html.indexOf("Checks"));
	});

	test("renders Tripwire's check output inside realistic GitHub checks chrome", () => {
		const html = renderToStaticMarkup(
			<GithubChecksPreview
				forge="github"
				check={{
					posted: true,
					verdict: "block",
					summary: "Blocked by Account age and Crypto address.",
				}}
			/>,
		);

		expect(html).toContain("1 failing, 2 successful checks");
		expect(html).toContain("tripwire");
		expect(html).toContain("Blocked by Account age and Crypto address");
		expect(html).toContain("CodeQL / Analyze");
		expect(html).toContain("Vercel / Preview");
		expect(html).toContain("View details on Tripwire");
	});

	test("shows the contributor activity that Tripwire responds to", () => {
		const html = renderToStaticMarkup(
			<ContributorCommentPreview forge="github" />,
		);

		expect(html).toContain("genesisrevelationinc-debug");
		expect(html).toContain("ShanaBoo Autonomous Fix");
		expect(html).toContain("Source: GitHub");
		expect(html).toContain("Auto-submitted by ShanaBoo CNS");
	});

	for (const forge of ["gitcafe", null] as const) {
		test(`${forge ?? "unresolved"} chrome identifies sample output without GitHub source or checks`, () => {
			const html = renderToStaticMarkup(
				<>
					<PullRequestHeader forge={forge} />
					<ContributorCommentPreview forge={forge} />
					<GithubChecksPreview
						forge={forge}
						check={{
							posted: true,
							verdict: "block",
							summary: "Blocked by Crypto address.",
						}}
					/>
				</>,
			);
			expect(html).toContain("Sample output");
			expect(html).toContain("Sample checks");
			expect(html).toContain("Sample analysis");
			expect(html).not.toContain("GitHub");
			expect(html).not.toContain("CodeQL");
			expect(html).not.toContain("Vercel");
			expect(html).not.toContain('href="https://github.com');
		});
	}

	test("shows the deployment state above the review summary", () => {
		const html = renderToStaticMarkup(<DeploymentPreview />);

		expect(html).toContain("This branch has not been deployed");
		expect(html).toContain("No deployments");
	});

	test("renders inert GitHub merge controls with Tripwire's review state", () => {
		const html = renderToStaticMarkup(<MergePreview />);

		expect(html).toContain("Changes reviewed");
		expect(html).toContain("1 requested change");
		expect(html).toContain("tripwire-sh[bot]");
		expect(html).toContain("Merge pull request");
		expect(html).toContain("View command line instructions");
		expect(html).not.toContain("<button");
	});
});

describe("preview scroll capture", () => {
	test("captures a wheel event that crosses the response controls at any velocity", () => {
		const range = { start: 300, end: 600 };

		expect(entersCaptureRange(0, 550, range)).toBe(true);
		expect(entersCaptureRange(900, 400, range)).toBe(true);
	});

	test("leaves ordinary scrolling alone outside the response controls", () => {
		const range = { start: 300, end: 600 };

		expect(entersCaptureRange(0, 250, range)).toBe(false);
		expect(entersCaptureRange(900, 700, range)).toBe(false);
	});
});
