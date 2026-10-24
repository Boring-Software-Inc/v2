import { lazy, type ReactNode, Suspense, useCallback, useState } from "react";
import { useCodeDark, WrapToggle } from "#/components/code/code-controls";
import { CodeHeader } from "#/components/code/code-header";
import {
	formatLineAnchor,
	type LineRange,
	parseLineAnchor,
} from "#/components/code/line-anchor";
import { PlainCode } from "#/components/code/plain-code";
import { CopyButton } from "#/components/glaze/ui/copy-button";
import { cn } from "#/lib/glaze/utils";

const PierreFile = lazy(() =>
	import("#/components/code/pierre-code").then((module) => ({
		default: module.PierreFile,
	})),
);

export interface TripwireCodeFileProps {
	name: string;
	code: string;
	lineAnchors?: boolean;
	actions?: ReactNode;
	className?: string;
}

export function TripwireCodeFile({
	name,
	code,
	lineAnchors = false,
	actions,
	className,
}: TripwireCodeFileProps) {
	const { mounted, dark } = useCodeDark();
	const [wrap, setWrap] = useState(false);
	const [picked, setPicked] = useState<LineRange | null>();
	const selected =
		picked !== undefined
			? picked
			: mounted && lineAnchors
				? parseLineAnchor(window.location.hash)
				: null;
	const select = useCallback((range: LineRange | null) => {
		setPicked(range);
		const { pathname, search } = window.location;
		window.history.replaceState(
			window.history.state,
			"",
			`${pathname}${search}${formatLineAnchor(range)}`,
		);
	}, []);
	const plain = <PlainCode code={code} />;
	return (
		<div
			className={cn(
				"min-w-0 overflow-hidden rounded-lg border border-line-faint bg-code-surface",
				className,
			)}
			data-slot="tripwire-code-file"
		>
			<CodeHeader name={name}>
				{actions}
				<WrapToggle onWrapChange={setWrap} wrap={wrap} />
				<CopyButton label={name} showLabel value={code} variant="secondary" />
			</CodeHeader>
			{mounted ? (
				<Suspense fallback={plain}>
					<PierreFile
						code={code}
						dark={dark}
						name={name}
						onSelect={lineAnchors ? select : undefined}
						selected={selected}
						wrap={wrap}
					/>
				</Suspense>
			) : (
				plain
			)}
		</div>
	);
}
