import { Cancel01Icon, Comment01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState, useSyncExternalStore } from "react";
import { useFeedback } from "#/components/feedback";
import { Button } from "#/components/ui/button";
import { Dither } from "#/components/ui/dither";
import { cn } from "#/lib/utils";

const STORAGE_KEY = "tripwire:beta-banner:dismissed";
const EVENT_NAME = "tripwire:beta-banner-dismissed";

function subscribe(callback: () => void): () => void {
	window.addEventListener(EVENT_NAME, callback);
	return () => window.removeEventListener(EVENT_NAME, callback);
}

function getSnapshot(): boolean {
	return window.localStorage.getItem(STORAGE_KEY) === "true";
}

function getServerSnapshot(): boolean {
	return true;
}

function dismiss(): void {
	window.localStorage.setItem(STORAGE_KEY, "true");
	window.dispatchEvent(new Event(EVENT_NAME));
}

export function BetaBanner() {
	const dismissed = useSyncExternalStore(
		subscribe,
		getSnapshot,
		getServerSnapshot,
	);
	const [closing, setClosing] = useState(false);
	const { open: openFeedback } = useFeedback();

	if (dismissed) return null;

	return (
		<div
			className={cn(
				"grid shrink-0 transition-[grid-template-rows] duration-[360ms]",
				closing ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
			)}
			style={{ transitionTimingFunction: "cubic-bezier(0.19, 1, 0.22, 1)" }}
			onTransitionEnd={(e) => {
				if (e.target === e.currentTarget) dismiss();
			}}
		>
			<div className="overflow-hidden">
				<div
					className={cn(
						"relative isolate flex items-center justify-center overflow-hidden border-b bg-surface-2 px-10 py-2 transition-opacity duration-200",
						closing && "opacity-0",
					)}
				>
					{/* Animated house dither across the banner (see design). */}
					<Dither className="-z-10 opacity-70" speed={1.22} />
					<button
						type="button"
						onClick={openFeedback}
						className="group flex flex-1 items-center justify-center gap-2 text-[13px] font-medium leading-tight text-foreground"
					>
						<span>
							Tripwire is in closed beta — hit a bug or something rough?
						</span>
						<span className="inline-flex items-center gap-1 rounded-md bg-surface-1 px-2 py-0.5 text-xs ring-1 ring-border transition-colors group-hover:bg-surface-0">
							<HugeiconsIcon icon={Comment01Icon} size={12} strokeWidth={2} />
							Send feedback
						</span>
					</button>
					<Button
						variant="ghost"
						aria-label="Dismiss beta banner"
						className="absolute right-2 h-6 w-6 p-0 text-muted-foreground hover:bg-transparent hover:opacity-70"
						onClick={() => setClosing(true)}
					>
						<HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
					</Button>
				</div>
			</div>
		</div>
	);
}
