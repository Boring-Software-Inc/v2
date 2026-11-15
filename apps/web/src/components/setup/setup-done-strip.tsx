import { Button } from "@tripwire/ui/button";
import { Close, Icon } from "@tripwire/ui/icon";
import { useState, useSyncExternalStore } from "react";
import {
	SetupStepList,
	SetupStepRow,
} from "#/components/setup/repo-setup-checklist";
import { StepDoneMark } from "#/components/setup/step-done-mark";
import type { RepoSetupProgress } from "#/lib/repo-setup";

const DISMISSED_EVENT = "tripwire:setup-done-dismissed";

function dismissedKey(org: string, repo: string): string {
	return `tripwire:setup-done-dismissed:${org}/${repo}`;
}

function subscribe(onChange: () => void): () => void {
	window.addEventListener("storage", onChange);
	window.addEventListener(DISMISSED_EVENT, onChange);
	return () => {
		window.removeEventListener("storage", onChange);
		window.removeEventListener(DISMISSED_EVENT, onChange);
	};
}

function readDismissed(key: string): boolean {
	try {
		return window.localStorage.getItem(key) === "1";
	} catch {
		return false;
	}
}

function useDismissed(org: string, repo: string) {
	const key = dismissedKey(org, repo);
	const dismissed = useSyncExternalStore(
		subscribe,
		() => readDismissed(key),
		() => true,
	);
	const dismiss = () => {
		try {
			window.localStorage.setItem(key, "1");
		} catch {}
		window.dispatchEvent(new Event(DISMISSED_EVENT));
	};
	return { dismissed, dismiss };
}

export function SetupDoneStrip({
	org,
	repo,
	progress,
}: {
	org: string;
	repo: string;
	progress: RepoSetupProgress;
}) {
	const { dismissed, dismiss } = useDismissed(org, repo);
	const [open, setOpen] = useState(false);
	if (dismissed) {
		return null;
	}
	return (
		<section
			aria-label="Setup"
			className="flex flex-col composition-gap-standard"
		>
			<div className="flex items-center composition-gap-standard rounded-shell bg-shell setup-done-strip-inset">
				<StepDoneMark size={16} />
				<span className="content-label tone-content-primary">Setup done</span>
				<span className="composition-push-end">
					<Button
						onAction={() => setOpen((value) => !value)}
						size="small"
						variant="ghost"
					>
						{open ? "Hide steps" : "Show steps"}
					</Button>
				</span>
				<Button
					ariaLabel="Dismiss"
					onAction={dismiss}
					size="small"
					variant="ghost"
				>
					<Icon icon={Close} />
				</Button>
			</div>
			{open ? (
				<SetupStepList className="px-1">
					{progress.steps.map((step) => (
						<SetupStepRow
							detail={step.detail}
							key={step.key}
							title={step.title}
							tone="done"
						/>
					))}
				</SetupStepList>
			) : null}
		</section>
	);
}
