import { lazy, type ReactNode, Suspense, useState } from "react";
import { useCodeDark, WrapToggle } from "#/components/code/code-controls";
import { CodeHeader, type DiffStats } from "#/components/code/code-header";
import { PlainCode } from "#/components/code/plain-code";
import { CopyButton } from "#/components/glaze/ui/copy-button";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { useMediaQuery } from "#/hooks/use-media-query";
import { cn } from "#/lib/glaze/utils";

const PierreDiff = lazy(() =>
	import("#/components/code/pierre-code").then((module) => ({
		default: module.PierreDiff,
	})),
);

export type CodeDiffLayout = "unified" | "split";

export interface TripwireCodeDiffProps {
	name: string;
	before: string;
	after: string;
	layout?: CodeDiffLayout;
	actions?: ReactNode;
	className?: string;
}

export function TripwireCodeDiff({
	name,
	before,
	after,
	layout = "unified",
	actions,
	className,
}: TripwireCodeDiffProps) {
	const { mounted, dark } = useCodeDark();
	const [wrap, setWrap] = useState(false);
	const [shown, setShown] = useState<CodeDiffLayout>(layout);
	const narrow = useMediaQuery("(max-width: 639.98px)");
	const header = (stats?: DiffStats) => (
		<CodeHeader name={name} stats={stats}>
			{actions}
			<SegmentedControl
				aria-label="Diff layout"
				className="max-sm:hidden"
				onValueChange={(next) => {
					if (next === "unified" || next === "split") {
						setShown(next);
					}
				}}
				size="sm"
				value={shown}
			>
				<SegmentedControlItem value="unified">Unified</SegmentedControlItem>
				<SegmentedControlItem value="split">Split</SegmentedControlItem>
			</SegmentedControl>
			<WrapToggle onWrapChange={setWrap} wrap={wrap} />
			<CopyButton label={name} showLabel value={after} variant="secondary" />
		</CodeHeader>
	);
	const plain = (
		<>
			{header()}
			<PlainCode code={after} />
		</>
	);
	return (
		<div
			className={cn(
				"min-w-0 overflow-hidden rounded-lg border border-line-faint bg-code-surface",
				className,
			)}
			data-slot="tripwire-code-diff"
		>
			{mounted ? (
				<Suspense fallback={plain}>
					<PierreDiff
						after={after}
						before={before}
						dark={dark}
						name={name}
						renderHeader={header}
						split={!narrow && shown === "split"}
						wrap={wrap}
					/>
				</Suspense>
			) : (
				plain
			)}
		</div>
	);
}
