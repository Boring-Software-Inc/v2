import type { LintFix } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Popover } from "@tripwire/ui/popover";
import { Status } from "@tripwire/ui/status";
import { Tooltip } from "@tripwire/ui/tooltip";
import { Label } from "@tripwire/ui/typography";
import {
	type Problem,
	problemCount,
	problemSections,
} from "#/components/workflows/editor/node-issues";

export function severityStatus(problems: readonly Problem[]): "fail" | "warn" {
	return problems.some((problem) => problem.severity === "error")
		? "fail"
		: "warn";
}

function ProblemRow({
	problem,
	onFix,
	onReveal,
}: {
	problem: Problem;
	onFix?: (problem: Problem, fix: LintFix) => void;
	onReveal?: (problem: Problem) => void;
}) {
	const target = problem.nodeId ?? problem.edgeId;
	const fixes = onFix
		? problem.fixes.slice(0, problem.severity === "error" ? 1 : 2)
		: [];
	return (
		<div
			className="group/problem"
			data-layout-role="workflow-problem-row"
			data-revealable={Boolean(target && onReveal) || undefined}
			data-problem-rule={problem.rule}
		>
			{target && onReveal ? (
				<button
					aria-label={`Show ${problem.step}`}
					className="absolute inset-0 rounded-md focus-visible:focus-ring"
					onClick={() => onReveal(problem)}
					type="button"
				/>
			) : null}
			<div data-layout-role="workflow-problem-copy">
				<Label data-layout-role="workflow-problem-step">{problem.step}</Label>
				<span data-layout-role="workflow-problem-message">
					{problem.message}
				</span>
			</div>
			{fixes.length > 0 ? (
				<div data-layout-role="workflow-problem-fixes">
					{fixes.map((fix, index) => (
						<Button
							key={fix.label}
							onAction={() => onFix?.(problem, fix)}
							size="small"
							variant={index === 0 ? "secondary" : "ghost"}
						>
							{fix.label}
						</Button>
					))}
				</div>
			) : null}
		</div>
	);
}

export function ProblemRows({
	problems,
	onFix,
	onReveal,
}: {
	problems: readonly Problem[];
	onFix?: (problem: Problem, fix: LintFix) => void;
	onReveal?: (problem: Problem) => void;
}) {
	const sections = problemSections(problems);
	return (
		<div className="flex flex-col">
			{sections.map((section, index) => (
				<section
					aria-label={section.title}
					data-layout-role="workflow-problem-section"
					data-after-section={index > 0 || undefined}
					key={section.key}
				>
					<h3 data-layout-role="workflow-problem-section-heading">
						{section.title}
					</h3>
					{section.problems.map((problem) => (
						<ProblemRow
							key={problem.key}
							onFix={onFix}
							onReveal={onReveal}
							problem={problem}
						/>
					))}
				</section>
			))}
		</div>
	);
}

export function ProblemsButton({
	problems,
	open,
	onOpenChange,
	onFix,
	onReveal,
}: {
	problems: readonly Problem[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onFix: (problem: Problem, fix: LintFix) => void;
	onReveal: (problem: Problem) => void;
}) {
	if (problems.length === 0) {
		return null;
	}
	const blocking = severityStatus(problems) === "fail";
	return (
		<Tooltip
			trigger={
				<span
					data-layout-role="workflow-problems-trigger"
					data-blocking={blocking || undefined}
				>
					<Popover
						align="end"
						finalFocus="none"
						onOpenChange={onOpenChange}
						open={open}
						trigger={
							<Button size="small" variant={blocking ? "ghost" : "secondary"}>
								{blocking ? (
									<Status size="small" status="fail">
										{problemCount(problems)}
									</Status>
								) : (
									problemCount(problems)
								)}
							</Button>
						}
						triggerLabel={`${problemCount(problems)} workflow problems`}
					>
						<div data-layout-role="workflow-problems-popup">
							<ProblemRows
								onFix={onFix}
								onReveal={onReveal}
								problems={problems}
							/>
						</div>
					</Popover>
				</span>
			}
		>
			{`${problemCount(problems)} workflow problems`}
		</Tooltip>
	);
}

export function ProblemPeek({
	problems,
	onFix,
	className,
	children,
}: {
	problems: readonly Problem[];
	onFix: (problem: Problem, fix: LintFix) => void;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<Popover
			hoverTiming="brief"
			interaction="hover"
			placement="top"
			trigger={
				<button className={`nodrag nopan ${className ?? ""}`} type="button">
					{children}
				</button>
			}
			triggerLabel={problems.map((problem) => problem.message).join(". ")}
		>
			<div data-layout-role="workflow-problem-peek">
				<ProblemRows onFix={onFix} problems={problems} />
			</div>
		</Popover>
	);
}
