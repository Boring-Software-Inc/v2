import { useSyncExternalStore } from "react";
import { ShaderDither } from "#/components/dither/shader-dither";
import { useFeedback } from "#/components/feedback";
import { Close, Comment, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";

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
	const { open: openFeedback } = useFeedback();

	if (dismissed) return null;

	return (
		<div className="relative isolate flex shrink-0 items-center justify-center gap-3 overflow-hidden border-line-faint border-b bg-shell px-10 py-1">
			<ShaderDither className="-z-10 max-md:hidden" mask="sides" tone="soft" />
			<p className="type-body-sm text-text-1">
				Tripwire is in closed beta.
				<span className="max-md:hidden"> Found a bug or something rough?</span>
			</p>
			<Button onClick={openFeedback} size="sm" variant="secondary">
				<Icon icon={Comment} size={12} />
				Send feedback
			</Button>
			<Button
				aria-label="Dismiss beta banner"
				className="absolute end-2"
				onClick={dismiss}
				size="icon-sm"
				variant="ghost"
			>
				<Icon icon={Close} size={12} />
			</Button>
		</div>
	);
}
