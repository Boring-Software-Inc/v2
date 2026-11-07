import type { LintFix } from "@tripwire/contracts";
import {
	type Problem,
	problemCount,
	problemSections,
} from "#/components/workflows/editor/node-issues";
import { cn } from "#/design-system/lib/utils";
import { Button } from "#/design-system/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/design-system/ui/popover";
import { Status } from "#/design-system/ui/status";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/design-system/ui/tooltip";
import { Label } from "#/design-system/ui/typography";

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
							onClick={() => onFix?.(problem, fix)}
							size="sm"
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
	const explanation = problems
		.filter((problem) => problem.severity === (blocking ? "error" : "warning"))
		.slice(0, 3)
		.map((problem) => ({
			key: problem.key,
			text: `${problem.step}: ${problem.message}`,
		}));
	return (
		<Popover onOpenChange={onOpenChange} open={open}>
			<div
				data-layout-role="workflow-problems-trigger"
				data-blocking={blocking || undefined}
			>
				<Tooltip>
					<TooltipTrigger render={<span className="inline-flex" />}>
						<PopoverTrigger
							render={
								<Button size="sm" variant={blocking ? "ghost" : "secondary"} />
							}
						>
							{blocking ? (
								<Status size="sm" status="fail">
									{problemCount(problems)}
								</Status>
							) : (
								problemCount(problems)
							)}
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent>
						<span className="flex max-w-72 flex-col gap-1">
							{explanation.map((line) => (
								<span key={line.key}>{line.text}</span>
							))}
						</span>
					</TooltipContent>
				</Tooltip>
			</div>
			<PopoverContent
				align="end"
				data-layout-role="workflow-problems-popup"
				finalFocus={false}
			>
				<ProblemRows onFix={onFix} onReveal={onReveal} problems={problems} />
			</PopoverContent>
		</Popover>
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
		<Popover>
			<PopoverTrigger
				closeDelay={150}
				delay={150}
				nativeButton={false}
				openOnHover
				render={<span className={cn("nodrag nopan", className)} />}
			>
				{children}
			</PopoverTrigger>
			<PopoverContent data-layout-role="workflow-problem-peek" side="top">
				<ProblemRows onFix={onFix} problems={problems} />
			</PopoverContent>
		</Popover>
	);
}
