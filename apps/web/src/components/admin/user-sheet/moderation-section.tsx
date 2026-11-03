import { Link } from "@tanstack/react-router";
import {
	ListRow,
	ListRows,
	QuietLine,
	SheetSectionBlock,
	SubHeading,
} from "#/components/admin/user-sheet/sheet-parts";
import { ChevronRight, Icon } from "#/design-system/icon";
import { RelativeTime } from "#/design-system/ui/relative-time";
import {
	Body,
	CodeText,
	Label,
	SupportingText,
} from "#/design-system/ui/typography";
import {
	changeRequestLabel,
	contributorVerdictLabel,
	moderationDecisionLabel,
} from "#/lib/admin-user-sheet";
import type { AdminUserView } from "#/lib/staff-users.functions";

export function ModerationSection({ view }: { view: AdminUserView }) {
	const { decisions, contributor } = view;
	return (
		<SheetSectionBlock id="moderation" title="Moderation">
			<div data-layout-role="user-sheet-subsection">
				<SubHeading count={decisions.total} title="Their decisions" />
				{decisions.items.length === 0 ? (
					<QuietLine>No human review decisions.</QuietLine>
				) : (
					<ListRows label="Their decisions">
						{decisions.items.map((item) => {
							const label = changeRequestLabel(
								item.repoFullName,
								item.subjectNumber,
							);
							return (
								<ListRow key={item.itemId}>
									<Label>{moderationDecisionLabel(item.status)}</Label>
									<Body as="span">{label}</Body>
									<SupportingText as="span">
										{item.decidedAt ? (
											<RelativeTime date={item.decidedAt} />
										) : null}
									</SupportingText>
									<Link
										aria-label={`Open the run for ${label}`}
										data-layout-role="user-sheet-row-link"
										params={{ runId: item.runId }}
										to="/runs/$runId"
									>
										<Icon icon={ChevronRight} />
									</Link>
								</ListRow>
							);
						})}
					</ListRows>
				)}
			</div>
			<div data-layout-role="user-sheet-subsection">
				<SubHeading count={contributor.total} title="As a contributor" />
				{contributor.runs.length === 0 ? (
					<QuietLine>No runs against their change requests.</QuietLine>
				) : (
					<ListRows label="As a contributor">
						{contributor.runs.map((run) => {
							const verdict = contributorVerdictLabel(run.verdict);
							const label = changeRequestLabel(
								run.repoFullName,
								run.subjectNumber,
							);
							return (
								<ListRow key={run.runId}>
									<span data-state-tone={verdict.tone}>
										<Label>{verdict.label}</Label>
									</span>
									<Body as="span">{label}</Body>
									<SupportingText as="span">
										{run.blockingRuleId ? (
											<CodeText as="span">{run.blockingRuleId}</CodeText>
										) : run.humanReviewed ? (
											"After human review"
										) : (
											<RelativeTime date={run.createdAt} />
										)}
									</SupportingText>
									<Link
										aria-label={`Open the run for ${label}`}
										data-layout-role="user-sheet-row-link"
										params={{ runId: run.runId }}
										to="/runs/$runId"
									>
										<Icon icon={ChevronRight} />
									</Link>
								</ListRow>
							);
						})}
					</ListRows>
				)}
			</div>
		</SheetSectionBlock>
	);
}
