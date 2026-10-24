import { Link } from "@tanstack/react-router";
import {
	ListRow,
	ListRows,
	QuietLine,
	SheetSectionBlock,
	SubHeading,
} from "#/components/admin/user-sheet/sheet-parts";
import { ChevronRight, Icon } from "#/components/glaze/icon";
import { RelativeTime } from "#/components/glaze/ui/relative-time";
import {
	changeRequestLabel,
	contributorVerdictLabel,
	moderationDecisionLabel,
} from "#/lib/admin-user-sheet";
import type { AdminUserView } from "#/lib/staff-users.functions";

const chevron =
	"inline-flex size-8 items-center justify-center rounded-pill text-text-2 hover:bg-hover focus-visible:focus-ring";

export function ModerationSection({ view }: { view: AdminUserView }) {
	const { decisions, contributor } = view;
	return (
		<SheetSectionBlock id="moderation" title="Moderation">
			<div className="flex flex-col">
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
									<span className="w-22 shrink-0 type-label text-text-1">
										{moderationDecisionLabel(item.status)}
									</span>
									<span className="min-w-0 flex-1 truncate text-text-1">
										{label}
									</span>
									<span className="text-text-2 sm:w-30 sm:shrink-0">
										{item.decidedAt ? (
											<RelativeTime date={item.decidedAt} />
										) : null}
									</span>
									<Link
										aria-label={`Open the run for ${label}`}
										className={chevron}
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
			<div className="flex flex-col">
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
									<span
										className={`w-22 shrink-0 type-label ${verdict.tone === "fail" ? "text-fail-text" : "text-text-1"}`}
									>
										{verdict.label}
									</span>
									<span className="min-w-0 flex-1 truncate text-text-1">
										{label}
									</span>
									<span className="truncate text-text-2 sm:w-30 sm:shrink-0">
										{run.blockingRuleId ? (
											<span className="mono">{run.blockingRuleId}</span>
										) : run.humanReviewed ? (
											"After human review"
										) : (
											<RelativeTime date={run.createdAt} />
										)}
									</span>
									<Link
										aria-label={`Open the run for ${label}`}
										className={chevron}
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
