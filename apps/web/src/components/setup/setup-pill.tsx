import { useMatch, useParams } from "@tanstack/react-router";
import { useState } from "react";
import {
	ChevronDown,
	ChevronUp,
	Icon,
	Pending,
	Success,
} from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";
import { compactStepAction } from "#/components/setup/setup-step-actions";
import { useRepoSetup } from "#/components/setup/use-repo-setup";
import { cn } from "#/lib/glaze/utils";
import { nextLabel } from "#/lib/repo-setup";

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
	const next = nextLabel(progress);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger
				render={
					<Button
						aria-label={`Setup ${progress.done} of ${progress.total}. ${next ?? ""}`}
						className={cn(
							"min-w-0 shrink-0",
							appearance === "rail" && "w-full shrink justify-start",
						)}
						size="sm"
						variant="secondary"
					/>
				}
			>
				<Icon className="max-sm:hidden" icon={Pending} />
				<span className="shrink-0 font-medium">
					<span className="max-sm:hidden">Setup </span>
					{progress.done} of {progress.total}
				</span>
				{next && appearance === "bar" ? (
					<span className="min-w-0 truncate text-text-2 max-md:hidden">
						{next}
					</span>
				) : null}
				<Icon className="max-sm:hidden" icon={open ? ChevronUp : ChevronDown} />
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
									{step.done ? (
										<Icon
											className="text-ok-text"
											icon={Success}
											label="Done"
											weight="fill"
										/>
									) : null}
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
