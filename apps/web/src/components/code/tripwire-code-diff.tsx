import { lazy, type ReactNode, Suspense, useId, useState } from "react";
import { useCodeDark, WrapToggle } from "#/components/code/code-controls";
import { CodeHeader, type DiffStats } from "#/components/code/code-header";
import { PlainCode } from "#/components/code/plain-code";
import { ChevronDown, ChevronRight, Icon } from "#/design-system/icon";
import { cn } from "#/design-system/lib/utils";
import { Button } from "#/design-system/ui/button";
import { CopyButton } from "#/design-system/ui/copy-button";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/design-system/ui/segmented-control";
import { useMediaQuery } from "#/hooks/use-media-query";

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
	review?: boolean;
}

export function TripwireCodeDiff({
	name,
	before,
	after,
	layout = "unified",
	actions,
	className,
	review = false,
}: TripwireCodeDiffProps) {
	const { mounted, dark } = useCodeDark();
	const [wrap, setWrap] = useState(false);
	const [shown, setShown] = useState<CodeDiffLayout>(layout);
	const [expanded, setExpanded] = useState(true);
	const contentId = useId();
	const narrow = useMediaQuery("(max-width: 639.98px)");
	const header = (stats?: DiffStats) => (
		<CodeHeader
			className={
				review ? "sticky top-0 z-10 bg-code-surface ps-1.5" : undefined
			}
			leading={
				review ? (
					<Button
						aria-controls={contentId}
						aria-expanded={expanded}
						aria-label={`${expanded ? "Collapse" : "Expand"} ${name} diff`}
						onClick={() => setExpanded(!expanded)}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<Icon icon={expanded ? ChevronDown : ChevronRight} />
					</Button>
				) : undefined
			}
			name={name}
			stats={stats}
		>
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
			<div hidden={!expanded} id={contentId}>
				<PlainCode code={after} />
			</div>
		</>
	);
	return (
		<div
			className={cn(
				"min-w-0 rounded-lg border border-line-faint bg-code-surface",
				review ? "overflow-clip rounded-shell" : "overflow-hidden",
				className,
			)}
			data-slot="tripwire-code-diff"
			data-review-diff={
				review ? (expanded ? "expanded" : "collapsed") : undefined
			}
		>
			{mounted ? (
				<Suspense fallback={plain}>
					<PierreDiff
						after={after}
						before={before}
						dark={dark}
						contentId={contentId}
						hidden={!expanded}
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
