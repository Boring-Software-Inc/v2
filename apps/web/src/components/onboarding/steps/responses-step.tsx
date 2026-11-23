import { useMutation, useQuery } from "@tanstack/react-query";
import {
	OPEN_REDACTION,
	type RedactionPolicy,
	type ResponseConfig,
	resolveRedaction,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Skeleton } from "@tripwire/ui/skeleton";
import { Switch } from "@tripwire/ui/switch";
import { useMemo } from "react";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import {
	type ResponseChoices,
	useOnboardingDraft,
} from "#/components/onboarding/onboarding-draft";
import { OnboardingStepHeader } from "#/components/onboarding/onboarding-frame";
import type { StepViewProps } from "#/components/onboarding/onboarding-steps";
import { ResponsesPreviewPage } from "#/components/onboarding/preview/responses-preview";
import { keepResponseDefaults } from "#/lib/repo-setup.functions";
import { saveRepoResponseConfig } from "#/lib/response.functions";
import {
	orgResponseDefaultsQueryOptions,
	responseConfigQueryOptions,
} from "#/lib/response.query";

const copy = ONBOARDING_COPY.responses;

const ROWS = [
	{ key: "block", ...copy.block },
	{ key: "review", ...copy.review },
	{ key: "close", ...copy.close },
] as const;

/** The repo's response config, its redaction policy, and the choices on screen. */
function useResponseChoices(flow: StepViewProps["flow"]) {
	const [draft] = useOnboardingDraft();
	const org = flow.state.orgSlug ?? flow.state.personalOrgSlug ?? "";
	const repoId = flow.state.repo?.id ?? "";
	const config = useQuery({
		...responseConfigQueryOptions(org, repoId),
		enabled: repoId !== "",
	});
	const orgDefaults = useQuery(orgResponseDefaultsQueryOptions(org));
	return useMemo(() => {
		if (!config.data) {
			return null;
		}
		const orgPolicy: RedactionPolicy =
			orgDefaults.data?.defaults.redaction ?? OPEN_REDACTION;
		const saved = config.data;
		const fromConfig: ResponseChoices = {
			block: saved.onBlock === "comment",
			review: saved.moderationQueued === "comment",
			close: saved.onClose === "comment",
			fix: resolveRedaction(saved.redaction, orgPolicy).showHelp,
		};
		const choices = draft.responses ?? fromConfig;
		const surface = (on: boolean): "comment" | "silent" =>
			on ? "comment" : "silent";
		const helpChanged = choices.fix !== fromConfig.fix;
		const next: ResponseConfig = {
			...saved,
			onBlock: surface(choices.block),
			moderationQueued: surface(choices.review),
			onClose: surface(choices.close),
			redaction: helpChanged
				? {
						...resolveRedaction(saved.redaction, orgPolicy),
						inherit: false,
						showHelp: choices.fix,
					}
				: saved.redaction,
		};
		return {
			org,
			repoId,
			choices,
			next,
			policy: resolveRedaction(next.redaction, orgPolicy),
		};
	}, [config.data, draft.responses, org, orgDefaults.data, repoId]);
}

/**
 * Step 7: where Tripwire speaks. Each outcome either comments on the change
 * request or stays quiet; the GitHub check posts either way.
 */
export function ResponsesStep({ flow }: StepViewProps) {
	const [, update] = useOnboardingDraft();
	const state = useResponseChoices(flow);
	const save = useMutation({
		mutationFn: async (mode: "keep" | "save") => {
			if (!state) {
				return;
			}
			if (mode === "keep") {
				await keepResponseDefaults({
					data: { org: state.org, repoId: state.repoId },
				});
				return;
			}
			const result = await saveRepoResponseConfig({
				data: { org: state.org, repoId: state.repoId, config: state.next },
			});
			if ("error" in result) {
				throw new Error(result.error);
			}
		},
		onSuccess: () => flow.advance(),
	});
	const set = (key: keyof ResponseChoices, value: boolean) => {
		if (state) {
			update({ responses: { ...state.choices, [key]: value } });
		}
	};

	return (
		<>
			<OnboardingStepHeader
				current={flow.step}
				steps={flow.steps}
				sub={copy.sub}
				title={copy.title}
			/>
			{state ? (
				<div data-layout-role="onboarding-fields">
					<section aria-label={copy.label} data-layout-role="onboarding-picks">
						<span data-layout-role="onboarding-field-legend">
							<span>{copy.label}</span>
						</span>
						{ROWS.map((row) => (
							<div data-layout-role="onboarding-pick-row" key={row.key}>
								<Switch
									checked={state.choices[row.key]}
									description={row.desc}
									label={row.name}
									onCheckedChange={(checked) => set(row.key, checked)}
								/>
							</div>
						))}
					</section>
					<div data-layout-role="onboarding-pick-row">
						<Switch
							checked={state.choices.fix}
							description={copy.fixDesc}
							label={copy.fixTitle}
							onCheckedChange={(checked) => set("fix", checked)}
						/>
					</div>
					<p data-layout-role="onboarding-note">{copy.note}</p>
				</div>
			) : (
				<Skeleton />
			)}
			{save.isError ? (
				<p data-layout-role="onboarding-error" role="alert">
					{ONBOARDING_COPY.saveFailed}
				</p>
			) : null}
			<div data-layout-role="onboarding-actions">
				<Button
					disabled={!state}
					onAction={() => save.mutate("keep")}
					pending={save.isPending && save.variables === "keep"}
					size="large"
					variant="secondary"
				>
					{copy.keepDefaults}
				</Button>
				<Button
					disabled={!state}
					onAction={() => save.mutate("save")}
					pending={save.isPending && save.variables === "save"}
					size="large"
					variant="primary"
				>
					{ONBOARDING_COPY.continue}
				</Button>
			</div>
		</>
	);
}

export function ResponsesPreview({ flow }: StepViewProps) {
	const state = useResponseChoices(flow);
	return (
		<ResponsesPreviewPage
			config={state?.next ?? null}
			org={flow.state.orgSlug ?? flow.state.personalOrgSlug ?? ""}
			policy={state?.policy ?? OPEN_REDACTION}
			repo={flow.state.repo}
		/>
	);
}
