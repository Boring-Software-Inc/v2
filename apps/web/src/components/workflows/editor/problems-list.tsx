import type { LintFix } from "@tripwire/contracts";
import { Button } from "#/components/glaze/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";
import { Status } from "#/components/glaze/ui/status";
import {
	type Problem,
	problemCount,
	problemSections,
} from "#/components/workflows/editor/node-issues";
import { cn } from "#/lib/glaze/utils";

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
			className={cn(
				"group/problem relative flex items-center gap-3 rounded-md p-2 transition-colors duration-(--dur-state)",
				target && onReveal && "hover:bg-hover",
			)}
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
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="type-label text-text-1 [overflow-wrap:anywhere]">
					{problem.step}
				</span>
				<span className="type-body-sm text-text-2 [overflow-wrap:anywhere]">
					{problem.message}
				</span>
			</div>
			{fixes.length > 0 ? (
				<div className="relative flex shrink-0 gap-1.5">
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
					className={cn(
						"flex flex-col",
						index > 0 && "-mx-1 mt-1 border-line-faint border-t px-1 pt-1",
					)}
					key={section.key}
				>
					<h3 className="px-2 pt-2 pb-1 type-caption text-text-2">
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
		<Popover onOpenChange={onOpenChange} open={open}>
			<div
				className={cn(
					"absolute end-3 top-3 z-(--z-raised) rounded-pill",
					blocking && "bg-fail-tint",
				)}
			>
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
			</div>
			<PopoverContent align="end" className="w-96 gap-0 p-1" finalFocus={false}>
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
			<PopoverContent className="w-80 gap-0 p-1" side="top">
				<ProblemRows onFix={onFix} problems={problems} />
			</PopoverContent>
		</Popover>
	);
}
