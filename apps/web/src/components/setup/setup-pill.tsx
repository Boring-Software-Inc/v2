import { useMatch, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";
import { compactStepAction } from "#/components/setup/setup-step-actions";
import { StepDoneMark } from "#/components/setup/step-done-mark";
import { useRepoSetup } from "#/components/setup/use-repo-setup";
import { cn } from "#/lib/glaze/utils";

const RING_RADIUS = 6;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function ProgressRing({ done, total }: { done: number; total: number }) {
	return (
		<svg
			aria-hidden="true"
			className="-rotate-90 size-4 shrink-0"
			viewBox="0 0 16 16"
		>
			<circle
				className="stroke-line-strong"
				cx="8"
				cy="8"
				fill="none"
				r={RING_RADIUS}
				strokeWidth="2"
			/>
			<circle
				className="stroke-ok"
				cx="8"
				cy="8"
				fill="none"
				r={RING_RADIUS}
				strokeDasharray={RING_LENGTH}
				strokeDashoffset={RING_LENGTH * (1 - done / total)}
				strokeLinecap="round"
				strokeWidth="2"
			/>
		</svg>
	);
}

export function SetupPill({
	appearance = "bar",
}: {
	appearance?: "bar" | "rail";
}) {
	const params = useParams({ strict: false });
	const org = params.org ?? "";
	const repo = params.repo ?? "";
	const onChecklist = useMatch({
		from: "/$org/$repo/moderation",
		shouldThrow: false,
	});
	const { state, progress } = useRepoSetup(org, repo);
	const [open, setOpen] = useState(false);
	if (!(state && progress) || progress.complete || onChecklist) {
		return null;
	}
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger
				render={
					<Button
						aria-label={`Setup, ${progress.done} of ${progress.total} done`}
						className={cn(
							"shrink-0 tabular-nums",
							appearance === "rail" && "w-full justify-start",
						)}
						size="sm"
						variant="secondary"
					/>
				}
			>
				<ProgressRing done={progress.done} total={progress.total} />
				{progress.done} of {progress.total}
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-(--popover) max-w-popover p-1"
				side={appearance === "rail" ? "right" : "bottom"}
			>
				<ol aria-label="Setup steps" className="flex flex-col gap-px">
					{progress.steps.map((step) => {
						const current = progress.current?.key === step.key;
						return (
							<li
								aria-current={current ? "step" : undefined}
								className={cn(
									"grid grid-cols-[--spacing(6)_minmax(0,1fr)] rounded-tag px-2 py-2",
									current && "bg-hover",
								)}
								key={step.key}
							>
								<span className="flex h-lh items-center type-body-sm">
									{step.done ? <StepDoneMark size={16} /> : null}
								</span>
								<div className="flex min-w-0 flex-col gap-2">
									<span
										className={cn(
											"type-body-sm",
											current ? "font-medium text-text-1" : "text-text-2",
											step.done && "text-text-1",
										)}
									>
										{step.title}
									</span>
									{current
										? compactStepAction(step.key, { org, repo, state })
										: null}
								</div>
							</li>
						);
					})}
				</ol>
			</PopoverContent>
		</Popover>
	);
}
