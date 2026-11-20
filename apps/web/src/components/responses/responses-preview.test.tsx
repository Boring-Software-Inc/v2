import { describe, expect, test } from "bun:test";
import {
	DEFAULT_RESPONSE_CONFIG,
	type ForgeId,
	OPEN_REDACTION,
	responseConfigSchema,
} from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { BlockContent } from "#/components/responses/blocks/block-content";
import { PreviewLinkProvider } from "#/components/responses/preview-link";
import {
	outcomeMeta,
	responsePreview,
} from "#/components/responses/responses-model";
import { ResponsesPreview } from "#/components/responses/responses-preview";
import { sampleRunFor } from "#/components/responses/sample-run";
import type { PreviewTab } from "#/lib/block-builder";

describe("Responses surface context", () => {
	const render = (
		tab: PreviewTab,
		config = DEFAULT_RESPONSE_CONFIG,
		scope: Parameters<typeof outcomeMeta>[0] = "block",
		forge: ForgeId | null = "github",
	) => {
		const outcome = outcomeMeta(scope);
		const preview = responsePreview(
			config,
			outcome,
			OPEN_REDACTION,
			"outsider",
			forge,
		);
		return renderToStaticMarkup(
			<PreviewLinkProvider>
				<ResponsesPreview
					canvas={<p>Draft comment blocks</p>}
					check={preview.check}
					onView={() => undefined}
					outcome={outcome}
					plan={preview.plan}
					run={sampleRunFor(outcome, preview.plan, preview.check, forge)}
					runPageLevel={preview.runPageLevel}
					view={{ tab, viewer: "outsider" }}
				/>
			</PreviewLinkProvider>,
		);
	};

	test("the check run is a distinct surface from the requested-changes review", () => {
		const html = render("check");
		expect(html).toContain("GitHub review");
		expect(html).toContain("Blocked by Account age and Crypto address.");
		expect(html).not.toContain("requested changes just now");
	});

	for (const forge of ["github", "gitcafe", null] as const) {
		test(`${forge ?? "unresolved"} run preview never links sample evidence to another forge`, () => {
			const html = render("run-page", DEFAULT_RESPONSE_CONFIG, "block", forge);
			expect(html).toContain("Sample preview");
			if (forge !== "github") expect(html).not.toContain("https://github.com");
		});
		test(`${forge ?? "unresolved"} review copy follows sample identity`, () => {
			const html = render("review", DEFAULT_RESPONSE_CONFIG, "block", forge);
			expect(html).toContain("This review requests changes.");
			expect(html).toContain(
				forge === "github"
					? "GitHub review"
					: forge === "gitcafe"
						? "GitCafe review"
						: 'title="Review"',
			);
			if (forge !== "github") expect(html).not.toContain("GitHub");
		});
	}

	test("a level-zero review explains its pointer and offers the full comment", () => {
		const html = render("review");
		expect(html).toContain("Blocked. See the comment.");
		expect(html).toContain(
			"The reasons and response blocks are in the separate PR comment.",
		);
		expect(html).toContain("View PR comment");
		expect(html).not.toContain("Hidden from outsiders");
	});

	test("a sole review renders the current blocks instead of a pointer", () => {
		const html = render(
			"review",
			responseConfigSchema.parse({
				onBlock: "silent",
				blocks: {
					block: [
						{
							id: "draft",
							type: "text",
							parts: [{ kind: "text", text: "Current draft response." }],
						},
					],
				},
			}),
		);
		expect(html).toContain("Current draft response.");
		expect(html).toContain("Tripwire posts no separate PR comment.");
		expect(html).not.toContain("View PR comment");
		expect(html).not.toContain("See the comment.");
	});

	test("outcomes without a GitHub review do not offer that surface", () => {
		const html = render("check", DEFAULT_RESPONSE_CONFIG, "changes_required");
		expect(html).not.toContain("GitHub review");
		expect(html).toContain("Changes needed. Change the target to main.");
	});

	test("empty sample blocks stay editable without looking redacted", () => {
		const content = (body: string | null) =>
			renderToStaticMarkup(
				<BlockContent
					output={{ block: { id: "ai", type: "ai-notice" }, body }}
				/>,
			);
		expect(content("")).toContain("AI review not run");
		expect(content("")).not.toContain("Hidden from outsiders");
		expect(content(null)).toContain("Hidden from outsiders");
	});
});
