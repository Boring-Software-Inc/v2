import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	DEFAULT_RESPONSE_CONFIG,
	type ForgeId,
	OPEN_REDACTION,
} from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ResponseBuilder } from "#/components/responses/blocks/response-builder";
import { PreviewLinkProvider } from "#/components/responses/preview-link";
import { RedactionControls } from "#/components/responses/redaction-controls";
import {
	OUTCOMES,
	responsePreview,
	sampleInput,
} from "#/components/responses/responses-model";
import { sampleRunFor } from "#/components/responses/sample-run";

describe("Responses forge context", () => {
	for (const forge of ["github", "gitcafe", null] as const) {
		for (const outcome of OUTCOMES) {
			test(`${forge ?? "unresolved"} ${outcome.value} preserves controls and identifies the preview`, () => {
				const html = renderToStaticMarkup(
					<PreviewLinkProvider>
						<ResponseBuilder
							forge={forge}
							outcome={outcome}
							config={DEFAULT_RESPONSE_CONFIG}
							policy={OPEN_REDACTION}
							orgPolicy={OPEN_REDACTION}
							canEdit
							org="test"
							onOutcomeChange={() => undefined}
							saveToolbar={null}
							setField={() => undefined}
						/>
					</PreviewLinkProvider>,
				);
				expect(html).toContain(
					`aria-label="${forge === "github" ? "GitHub response preview" : forge === "gitcafe" ? "GitCafe response preview" : "Response preview"}"`,
				);
				expect(html).toContain("Select a block to edit its output.");
				expect(html).toContain("Publish these response blocks.");
				expect(html).toContain('data-layout-role="response-builder"');
				if (forge !== "github") expect(html).not.toContain("GitHub");
			});
		}
	}

	for (const forge of ["github", "gitcafe"] satisfies ForgeId[]) {
		test(`${forge} sample models retain forge identity at every redaction level and outcome`, () => {
			for (const outcome of OUTCOMES) {
				for (const level of [0, 4]) {
					const preview = responsePreview(
						DEFAULT_RESPONSE_CONFIG,
						outcome,
						{ ...OPEN_REDACTION, level },
						"outsider",
						forge,
					);
					const run = sampleRunFor(outcome, preview.plan, preview.check, forge);
					expect(run.forge).toBe(forge);
					expect(run.subjectUrl).toBeNull();
					if (forge === "gitcafe") {
						expect(
							run.steps.some((step) => step.ruleRef === "account-age@1"),
						).toBe(false);
						expect(
							sampleInput(outcome, forge).reasons.some(
								(reason) => reason.ruleId === "account-age",
							),
						).toBe(false);
					}
				}
			}
		});
	}

	test("an unresolved sample never assumes GitHub identity", () => {
		const outcome = OUTCOMES[0];
		if (!outcome) throw new Error("Missing block outcome");
		const preview = responsePreview(
			DEFAULT_RESPONSE_CONFIG,
			outcome,
			OPEN_REDACTION,
			"outsider",
		);
		expect(sampleRunFor(outcome, preview.plan, preview.check).forge).toBeNull();
	});

	test("workspace redaction has a neutral review label without repository context", () => {
		const html = renderToStaticMarkup(
			<PreviewLinkProvider>
				<RedactionControls
					policy={OPEN_REDACTION}
					disabled={false}
					onLevel={() => undefined}
					onSurfaces={() => undefined}
					onShowHelp={() => undefined}
				/>
			</PreviewLinkProvider>,
		);
		expect(html).not.toContain("GitHub");
	});

	test("mobile instructions remain provider neutral", () => {
		const source = readFileSync(
			new URL("./responses-mobile-blocker.tsx", import.meta.url),
			"utf8",
		);
		expect(source).toContain("Use a desktop to build and preview responses.");
		expect(source).not.toContain("GitHub responses");
	});
});
