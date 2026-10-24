import { lazy, type ReactNode, Suspense, useCallback, useState } from "react";
import { useCodeDark, WrapToggle } from "#/components/code/code-controls";
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

function initialRange(lineAnchors: boolean): LineRange | null {
	if (!lineAnchors || typeof window === "undefined") {
		return null;
	}
	return parseLineAnchor(window.location.hash);
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
	const [selected, setSelected] = useState(() => initialRange(lineAnchors));
	const select = useCallback((range: LineRange | null) => {
		setSelected(range);
		const { pathname, search } = window.location;
		window.history.replaceState(
			window.history.state,
			"",
			`${pathname}${search}${formatLineAnchor(range)}`,
		);
	}, []);
	const header = (
		<div className="flex items-center gap-1">
			{actions}
			<WrapToggle onWrapChange={setWrap} wrap={wrap} />
			<CopyButton label={name} showLabel value={code} variant="secondary" />
		</div>
	);
	const plain = <PlainCode code={code} header={header} name={name} />;
	return (
		<div
			className={cn(
				"min-w-0 overflow-hidden rounded-lg border border-line-faint bg-code-surface",
				className,
			)}
			data-slot="tripwire-code-file"
		>
			{mounted ? (
				<Suspense fallback={plain}>
					<PierreFile
						code={code}
						dark={dark}
						header={header}
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
