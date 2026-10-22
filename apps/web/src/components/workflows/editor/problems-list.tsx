import type { LintFix } from "@tripwire/contracts";
import { Icon, Pointer } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemMedia,
} from "#/components/glaze/ui/item";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";
import { Status, StatusMark } from "#/components/glaze/ui/status";
import {
	type Problem,
	problemCount,
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
	const fixes = onFix ? problem.fixes : [];
	return (
		<Item className="items-start" data-problem-rule={problem.rule} size="sm">
			<ItemMedia>
				<StatusMark
					label={problem.severity === "error" ? "Error" : "Warning"}
					status={problem.severity === "error" ? "fail" : "warn"}
				/>
			</ItemMedia>
			<ItemContent className="gap-1.5">
				<p className="type-body-sm">
					{problem.rule ? (
						<span className="me-1.5 type-code-xs text-text-3">
							{problem.rule}
						</span>
					) : null}
					{problem.message}
				</p>
				{fixes.length > 0 ? (
					<div className="relative z-(--z-raised) flex flex-wrap gap-1">
						{fixes.map((fix) => (
							<Button
								key={fix.label}
								onClick={() => onFix?.(problem, fix)}
								size="sm"
								variant="secondary"
							>
								{fix.label}
							</Button>
						))}
					</div>
				) : null}
			</ItemContent>
			{target && onReveal ? (
				<Button
					aria-label="Show on canvas"
					className="static after:absolute after:inset-0 after:content-['']"
					data-slot="item-link"
					onClick={() => onReveal(problem)}
					size="icon-sm"
					variant="ghost"
				>
					<Icon
						className="opacity-0 transition-opacity duration-(--dur-state) group-hover/item:opacity-100 group-has-[[data-slot=item-link]:focus-visible]/item:opacity-100 pointer-coarse:opacity-100"
						icon={Pointer}
					/>
				</Button>
			) : null}
		</Item>
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
	return (
		<ItemGroup aria-label="Problems" variant="plain">
			{problems.map((problem) => (
				<ProblemRow
					key={problem.key}
					onFix={onFix}
					onReveal={onReveal}
					problem={problem}
				/>
			))}
		</ItemGroup>
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
	const status = severityStatus(problems);
	return (
		<Popover onOpenChange={onOpenChange} open={open}>
			<div
				className={cn(
					"absolute end-3 top-3 z-(--z-raised) rounded-pill",
					status === "fail" && "bg-fail-tint",
				)}
			>
				<PopoverTrigger
					render={
						<Button
							size="sm"
							variant={status === "fail" ? "ghost" : "secondary"}
						/>
					}
				>
					<Status size="sm" status={status}>
						{problemCount(problems)}
					</Status>
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
