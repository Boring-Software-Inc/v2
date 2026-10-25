import { useState, useSyncExternalStore } from "react";
import { Close, Icon, Success } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	SetupStepList,
	SetupStepRow,
} from "#/components/setup/repo-setup-checklist";
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
		<section aria-label="Setup" className="flex flex-col gap-2">
			<div className="flex items-center gap-2 rounded-shell bg-shell py-1 ps-4 pe-1">
				<Icon className="text-ok-text" icon={Success} weight="fill" />
				<span className="type-label text-text-1">Setup done</span>
				<Button
					aria-expanded={open}
					className="ms-auto"
					onClick={() => setOpen((value) => !value)}
					size="sm"
					variant="ghost"
				>
					{open ? "Hide steps" : "Show steps"}
				</Button>
				<Button
					aria-label="Dismiss"
					onClick={dismiss}
					size="icon-sm"
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
