import { useQuery } from "@tanstack/react-query";
import { Link, useMatch, useParams } from "@tanstack/react-router";
import { Button, IconButton } from "@tripwire/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@tripwire/ui/card";
import { ChevronRight, Icon, Subtract } from "@tripwire/ui/icon";
import { Popover } from "@tripwire/ui/popover";
import { Progress } from "@tripwire/ui/progress";
import { Caption } from "@tripwire/ui/typography";
import { useState, useSyncExternalStore } from "react";
import { compactStepAction } from "#/components/setup/setup-step-actions";
import { StepDoneMark } from "#/components/setup/step-done-mark";
import { useRepoSetup } from "#/components/setup/use-repo-setup";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import "#/components/setup/setup-progress.css";

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
				cx="8"
				cy="8"
				data-layout-role="setup-ring-track"
				fill="none"
				r={RING_RADIUS}
				strokeWidth="2"
			/>
			<circle
				cx="8"
				cy="8"
				data-layout-role="setup-ring-value"
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

const DISMISSED_EVENT = "tripwire:setup-progress-dismissed";

function subscribeDismissal(onChange: () => void) {
	window.addEventListener("storage", onChange);
	window.addEventListener(DISMISSED_EVENT, onChange);
	return () => {
		window.removeEventListener("storage", onChange);
		window.removeEventListener(DISMISSED_EVENT, onChange);
	};
}

type SetupProgressProps = { userId: string | undefined } & (
	| { placement: "sidebar"; onDismiss: () => void }
	| { placement: "mobile" }
);

export function SetupProgress(props: SetupProgressProps) {
	const params = useParams({ strict: false });
	const org = params.org ?? "";
	const repo = params.repo ?? "";
	const onChecklist = useMatch({
		from: "/$org/$repo/moderation",
		shouldThrow: false,
	});
	const { state, progress } = useRepoSetup(org, repo);
	const { data: session } = useQuery(sessionInfoQueryOptions());
	const [open, setOpen] = useState(false);
	const [dismissedKey, setDismissedKey] = useState<string | null>(null);
	const storageKey =
		state && props.userId
			? `${DISMISSED_EVENT}:${props.userId}:${state.repoId}`
			: null;
	const dismissed = useSyncExternalStore(
		subscribeDismissal,
		() => {
			if (!storageKey) return false;
			try {
				return window.localStorage.getItem(storageKey) === "1";
			} catch {
				return false;
			}
		},
		() => false,
	);
	if (
		!(state && progress && storageKey) ||
		dismissed ||
		dismissedKey === storageKey ||
		progress.complete ||
		onChecklist ||
		session?.onboardedRepoId === state.repoId
	) {
		return null;
	}

	const sidebar = props.placement === "sidebar";
	const count = `${progress.done} of ${progress.total}`;
	const steps = (
		<ol
			aria-label="Setup steps"
			data-layout-role={
				sidebar ? "sidebar-setup-timeline" : "mobile-setup-timeline"
			}
		>
			{progress.steps.map((step) => {
				const current = progress.current?.key === step.key;
				const replayLink =
					sidebar &&
					step.key === "check" &&
					state.facts.nextChangeRequest === null;
				return (
					<li
						aria-current={current ? "step" : undefined}
						data-complete={step.done || undefined}
						data-layout-role="setup-step"
						key={step.key}
					>
						<span data-layout-role="setup-step-marker">
							{step.done ? (
								<StepDoneMark size={16} />
							) : sidebar ? (
								<span
									aria-hidden="true"
									data-layout-role="sidebar-setup-marker-pending"
								/>
							) : null}
						</span>
						<div data-layout-role="setup-step-content">
							<span data-layout-role="setup-step-title">{step.title}</span>
							{current ? (
								replayLink ? (
									<Link
										data-layout-role="setup-step-replay"
										params={{ org, repo }}
										to="/$org/$repo/moderation/replay"
									>
										Rule replay
										<Icon icon={ChevronRight} />
									</Link>
								) : (
									compactStepAction(step.key, { org, repo, state })
								)
							) : null}
						</div>
					</li>
				);
			})}
		</ol>
	);

	if (sidebar) {
		const dismiss = () => {
			props.onDismiss();
			setDismissedKey(storageKey);
			try {
				window.localStorage.setItem(storageKey, "1");
			} catch {}
			window.dispatchEvent(new Event(DISMISSED_EVENT));
		};
		return (
			<section
				aria-label="Setup progress"
				data-layout-role="sidebar-setup-progress"
			>
				<Card>
					<CardHeader>
						<CardTitle>Repository setup</CardTitle>
						<CardAction>
							<IconButton
								icon={<Icon icon={Subtract} />}
								label="Dismiss setup progress"
								onAction={dismiss}
								size="small"
								variant="ghost"
							/>
						</CardAction>
					</CardHeader>
					<CardContent>
						<div data-layout-role="sidebar-setup-meter">
							<Progress
								ariaLabel="Steps completed"
								max={progress.total}
								showHeader={false}
								value={progress.done}
								valueText={count}
							/>
							<Caption aria-hidden="true">{count}</Caption>
						</div>
						{steps}
					</CardContent>
				</Card>
			</section>
		);
	}

	const triggerLabel = `Setup, ${count} done`;
	return (
		<div className="shrink-0 tabular-nums">
			<Popover
				align="start"
				onOpenChange={setOpen}
				open={open}
				placement="bottom"
				trigger={
					<Button
						ariaLabel={triggerLabel}
						leadingIcon={
							<ProgressRing done={progress.done} total={progress.total} />
						}
						size="small"
						variant="secondary"
					>
						{count}
					</Button>
				}
				triggerLabel={triggerLabel}
			>
				{steps}
			</Popover>
		</div>
	);
}
