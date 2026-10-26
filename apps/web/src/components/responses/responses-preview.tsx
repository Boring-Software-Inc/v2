import type { BlockViewer, SurfacePlan } from "@tripwire/contracts";
import { type ReactNode, useId, useLayoutEffect } from "react";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/glaze/ui/select";
import { StatusMark } from "#/components/glaze/ui/status";
import { CheckStateMock } from "#/components/responses/check-state-mock";
import { GithubCommentMock } from "#/components/responses/github-comment-mock";
import { usePreviewLink } from "#/components/responses/preview-link";
import type {
	CheckPreview,
	OutcomeMeta,
} from "#/components/responses/responses-model";
import { RunPageMock } from "#/components/responses/run-page-mock";
import type { PreviewTab, PreviewView } from "#/lib/block-builder";
import { pickValue } from "#/lib/pick-value";
import type { RunView } from "#/lib/runs.functions";

const TABS: { value: PreviewTab; label: string }[] = [
	{ value: "check", label: "Check run" },
	{ value: "comment", label: "PR comment" },
	{ value: "run-page", label: "Run page" },
];

const VIEWERS: { value: BlockViewer; label: string }[] = [
	{ value: "outsider", label: "Outsider" },
	{ value: "member", label: "Member" },
];

const TAB_VALUES = TABS.map((tab) => tab.value);
const VIEWER_VALUES = VIEWERS.map((viewer) => viewer.value);

export interface ResponsesPreviewProps {
	view: PreviewView;
	outcome: OutcomeMeta;
	plan: SurfacePlan;
	check: CheckPreview;
	run: RunView;
	runPageLevel: number;
	canvas: ReactNode;
	onView: (view: Partial<PreviewView>) => void;
}

export function ResponsesPreview({
	view,
	outcome,
	plan,
	check,
	run,
	runPageLevel,
	canvas,
	onView,
}: ResponsesPreviewProps) {
	const titleId = useId();
	const setTab = (value: string) => {
		const tab = pickValue(TAB_VALUES, value);
		if (tab) {
			onView({ tab });
		}
	};
	const setViewer = (value: string | null) => {
		const viewer = pickValue(VIEWER_VALUES, value ?? "");
		if (viewer) {
			onView({ viewer });
		}
	};
	const link = usePreviewLink();
	useLayoutEffect(() => {
		link.refresh();
	});

	return (
		<section
			aria-labelledby={titleId}
			className="flex min-h-0 flex-col rounded-shell border border-line-faint bg-shell"
			ref={link.attach}
		>
			<header className="flex shrink-0 flex-wrap items-center gap-3 px-6 py-3">
				<h2 className="me-auto type-label-lg text-text-1" id={titleId}>
					Preview
				</h2>
				<SegmentedControl
					aria-label="Surface"
					onValueChange={setTab}
					size="sm"
					value={view.tab}
				>
					{TABS.map((tab) => (
						<SegmentedControlItem key={tab.value} value={tab.value}>
							{tab.label}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
				<Select items={VIEWERS} onValueChange={setViewer} value={view.viewer}>
					<SelectTrigger aria-label="Viewer" className="w-32" size="sm">
						<SelectValue />
					</SelectTrigger>
					<SelectContent size="sm">
						{VIEWERS.map((viewer) => (
							<SelectItem key={viewer.value} value={viewer.value}>
								{viewer.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
				{view.tab === "comment" ? canvas : null}
				{view.tab === "check" ? (
					<div className="flex flex-col gap-6">
						{plan.review ? (
							<GithubCommentMock action="review" body={plan.review} />
						) : null}
						<div className="sm:ms-13" data-region="check">
							<CheckStateMock
								posted={check.posted}
								summary={check.summary}
								verdict={check.verdict}
							/>
						</div>
						{outcome.value === "close" ? (
							<p className="flex items-center gap-2 type-body-sm text-text-2 sm:ms-13">
								<span className="text-fail-text">
									<StatusMark label="Closed" status="fail" />
								</span>
								<span>
									<span className="font-semibold text-text-1">tripwire</span>{" "}
									closed this change request
								</span>
							</p>
						) : null}
					</div>
				) : null}
				{view.tab === "run-page" ? (
					<div className="sm:ms-13" data-region="run-page">
						<RunPageMock level={runPageLevel} run={run} />
					</div>
				) : null}
			</div>
		</section>
	);
}
