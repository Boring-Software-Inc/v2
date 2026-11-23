import { Icon, Pending } from "@tripwire/ui/icon";
import { SupportingText } from "@tripwire/ui/typography";
import { lazy } from "react";
import { CODE_THEMES } from "#/components/code/code-theme";
import type {
	PierreDiffProps,
	PierreFileProps,
} from "#/components/code/pierre-code";

let pierreCodePromise: Promise<
	typeof import("#/components/code/pierre-code")
> | null = null;

export function loadPierreCode() {
	pierreCodePromise ??= import("#/components/code/pierre-code").then(
		async (module) => {
			const { preloadHighlighter } = await import("@pierre/diffs");
			await preloadHighlighter({
				themes: [CODE_THEMES.light, CODE_THEMES.dark],
				langs: ["typescript"],
			});
			return module;
		},
	);
	return pierreCodePromise;
}

function CodeRendererError() {
	return (
		<div
			data-layout-role="code-renderer-error"
			data-slot="tripwire-code-error"
			role="alert"
		>
			<SupportingText>
				Code preview unavailable. Try reloading the page.
			</SupportingText>
		</div>
	);
}

function FailedPierreFile(_props: PierreFileProps) {
	return <CodeRendererError />;
}

function FailedPierreDiff({ renderHeader }: PierreDiffProps) {
	return (
		<>
			{renderHeader()}
			<CodeRendererError />
		</>
	);
}

type PierreCodeLoader = typeof loadPierreCode;

export function loadPierreFileComponent(
	load: PierreCodeLoader = loadPierreCode,
) {
	return load().then(
		(module) => ({ default: module.PierreFile }),
		() => ({ default: FailedPierreFile }),
	);
}

export function loadPierreDiffComponent(
	load: PierreCodeLoader = loadPierreCode,
) {
	return load().then(
		(module) => ({ default: module.PierreDiff }),
		() => ({ default: FailedPierreDiff }),
	);
}

export const LazyPierreFile = lazy(() => loadPierreFileComponent());

export const LazyPierreDiff = lazy(() => loadPierreDiffComponent());

export function CodeRendererLoading() {
	return (
		<output
			aria-label="Formatting code"
			data-layout-role="code-renderer-loading"
			data-slot="tripwire-code-loading"
		>
			<Icon icon={Pending} motion="spin" />
		</output>
	);
}
