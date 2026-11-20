import {
	type BlockOutput,
	CHECK_NAME,
	FORGE_BY_ID,
	type ForgeId,
	type SurfacePlan,
} from "@tripwire/contracts";
import { Badge } from "@tripwire/ui/badge";
import {
	ChangeRequest,
	Check,
	Checks,
	ChevronDown,
	Conversation,
	Copy,
	Diff,
	External,
	Icon,
	More,
	Upload,
} from "@tripwire/ui/icon";
import { Status, type StatusValue } from "@tripwire/ui/status";
import { Tabs } from "@tripwire/ui/tabs";
import {
	AnimatePresence,
	animate,
	motion,
	useReducedMotion,
} from "motion/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { BlockCanvas } from "#/components/responses/blocks/block-canvas";
import type { BlockBuilder } from "#/components/responses/blocks/use-block-builder";
import { GithubCommentMock } from "#/components/responses/github-comment-mock";
import type { CheckPreview } from "#/components/responses/responses-model";
import { cn } from "#/lib/utils";

const LOCAL_APPEARANCE = {
	checkRow: "flex items-start gap-2 rounded-tag px-2 py-2",
	checkRowSelected: "bg-hover",
	node115_1: "border-b border-line-faint pb-4",
	node116_2: "flex items-start gap-2",
	node117_3: "mt-1 text-text-2",
	node120_4: "min-w-0",
	node121_5: "type-heading text-text-1",
	node123_6: "font-normal text-text-2",
	node125_7: "mt-2 flex flex-wrap items-center gap-2 type-body-sm text-text-2",
	node129_8: "flex flex-wrap items-center gap-1.5",
	node130_9: "font-semibold text-text-1",
	node134_10: "rounded-tag bg-shell px-1.5 py-0.5",
	node138_11: "rounded-tag bg-shell px-1.5 py-0.5",
	node215_12: "grid size-6 shrink-0 place-items-center rounded-tag bg-paper",
	node222_13: "min-w-0 flex-1",
	node223_14: "truncate type-label text-text-1",
	node224_15: "mt-0.5 truncate type-caption text-text-2",
	node228_16: "mt-0.5",
	node229_17: "sr-only",
	node250_18:
		"@container/checks overflow-hidden rounded-panel border border-line-faint bg-paper",
	node252_19:
		"grid min-h-[28rem] grid-cols-1 @min-[38rem]/checks:grid-cols-[14rem_minmax(0,1fr)]",
	node253_20:
		"border-b border-line-faint bg-shell p-3 @min-[38rem]/checks:border-e @min-[38rem]/checks:border-b-0",
	node254_21: "type-heading-sm text-text-1",
	node255_22: "mt-1 type-caption text-text-2",
	node256_23: "mt-3 flex flex-col gap-1",
	node276_24: "min-w-0",
	node277_25:
		"flex flex-wrap items-center gap-3 border-b border-line-faint px-5 py-4",
	node278_26: "grid size-8 place-items-center rounded-tag bg-shell",
	node281_27: "min-w-0 flex-1",
	node282_28: "type-heading-sm text-text-1",
	node287_29:
		"inline-flex items-center gap-1 type-label-sm text-text-2 underline underline-offset-2",
	node292_30: "p-5",
	node293_31: "type-heading text-text-1",
	node296_32: "mt-3 max-w-(--measure) type-body text-text-2",
	node299_33: "mt-5 border-t border-line-faint pt-4",
	node300_34: "inline-flex items-center gap-1.5 type-label text-text-1",
	node315_35: "flex snap-center snap-always items-start gap-3",
	node320_36: "size-10 shrink-0 rounded-pill object-cover",
	node325_37:
		"min-w-0 flex-1 overflow-hidden rounded-panel border border-line-faint bg-paper",
	node326_38:
		"flex flex-wrap items-center gap-2 border-b border-line-faint bg-shell px-4 py-2",
	node327_39: "type-label text-text-1",
	node330_40: "ms-auto type-body-sm text-text-2",
	node336_41: "flex flex-col gap-3 p-4 type-body text-text-1",
	node337_42: "flex items-center gap-2 type-label",
	node343_43: "font-semibold",
	node344_44: "underline underline-offset-2",
	node350_45: "underline underline-offset-2",
	node352_46: "italic text-text-2",
	node365_47:
		"snap-center snap-always rounded-panel border border-line-faint bg-paper p-4",
	node368_48: "flex items-start gap-3",
	node369_49:
		"grid size-8 shrink-0 place-items-center rounded-pill bg-shell text-text-1",
	node373_50: "type-label text-text-1",
	node376_51: "mt-1 type-body-sm text-text-2",
	node387_52:
		"snap-center snap-always overflow-hidden rounded-panel border border-line-faint bg-paper",
	node390_53: "flex items-start gap-3 p-4",
	node391_54:
		"grid size-8 shrink-0 place-items-center rounded-pill bg-shell text-text-1",
	node394_55: "min-w-0 flex-1",
	node395_56: "type-heading-sm text-text-1",
	node396_57: "mt-1 type-body-sm text-text-2",
	node402_58: "px-4 pb-4",
	node403_59: "flex items-center gap-1.5 type-label-sm text-text-2",
	node408_60: "mt-3 flex items-center gap-2 type-body-sm text-text-2",
	node409_61: "grid size-5 place-items-center rounded-tag bg-shell",
	node412_62: "font-semibold text-text-1",
	node418_63: "mt-4 flex items-start gap-3",
	node419_64:
		"grid size-8 shrink-0 place-items-center rounded-pill bg-shell text-text-1",
	node423_65: "type-label text-text-1",
	node426_66: "mt-1 type-body-sm text-text-2",
	node432_67:
		"flex flex-wrap items-center gap-2 border-t border-line-faint bg-shell p-4",
	node433_68:
		"inline-flex min-h-(--control) cursor-default select-none items-stretch rounded-tag border border-line-control bg-paper type-label text-text-1",
	node434_69: "inline-flex items-center px-3",
	node437_70:
		"grid w-(--control) place-items-center border-s border-line-control",
	node441_71: "type-body-sm text-text-2",
	node673_72: "relative min-h-0 overflow-hidden bg-page",
	node677_73:
		"pointer-events-none absolute inset-x-0 top-0 z-20 h-32 bg-[linear-gradient(to_bottom,var(--page)_0%,var(--page)_18%,color-mix(in_oklab,var(--page)_96%,transparent)_36%,color-mix(in_oklab,var(--page)_78%,transparent)_56%,color-mix(in_oklab,var(--page)_38%,transparent)_76%,transparent_100%)]",
	node681_74:
		"pointer-events-none absolute inset-x-0 bottom-0 z-20 h-20 bg-[linear-gradient(to_top,var(--page)_0%,color-mix(in_oklab,var(--page)_92%,transparent)_24%,color-mix(in_oklab,var(--page)_58%,transparent)_56%,transparent_100%)]",
	node685_75:
		"pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-6 [&_[data-layout-role=unsaved-changes-toolbar]]:pointer-events-auto",
	node692_76:
		"h-full scroll-py-28 overflow-y-auto overscroll-contain px-8 pt-20 pb-24",
	node708_77: "mx-auto w-full max-w-3xl",
	node710_78: "mt-4 border-b border-line-faint pb-3",
	node721_79: "mt-5 flex flex-col gap-5",
	node731_80: "snap-center",
	node753_81: "snap-center snap-always",
	node768_82: "mt-5",
} as const;

const CONTRIBUTOR_AVATAR =
	"https://app.paper.design/file-assets/01M64X50A4QP7ZJNSZH1JCCA2B/01M7NC3Z11XK294SH9YGGGAT29.png";
const CAPTURE_ENTRY_PADDING_PX = 96;
const CAPTURE_RELEASE_PADDING_PX = 120;
const EXIT_INTENTS_REQUIRED = 2;

type ScrollDirection = -1 | 1;
type GithubPreviewTab = "conversation" | "checks";

export interface CaptureRange {
	start: number;
	end: number;
}

function clampScroll(root: HTMLDivElement, value: number): number {
	return Math.max(0, Math.min(root.scrollHeight - root.clientHeight, value));
}

function targetScrollTop(root: HTMLDivElement, target: HTMLElement): number {
	const rootRect = root.getBoundingClientRect();
	const targetRect = target.getBoundingClientRect();
	return clampScroll(
		root,
		root.scrollTop +
			targetRect.top -
			rootRect.top -
			(root.clientHeight - targetRect.height) / 2,
	);
}

function captureRange(root: HTMLDivElement): CaptureRange | null {
	const targets = [...root.querySelectorAll<HTMLElement>("[data-block-id]")];
	const first = targets[0];
	const last = targets.at(-1);
	if (!(first && last)) return null;
	const firstTop = targetScrollTop(root, first);
	const lastTop = targetScrollTop(root, last);
	return {
		start: clampScroll(
			root,
			Math.min(firstTop, lastTop) - CAPTURE_ENTRY_PADDING_PX,
		),
		end: clampScroll(
			root,
			Math.max(firstTop, lastTop) + CAPTURE_ENTRY_PADDING_PX,
		),
	};
}

export function entersCaptureRange(
	current: number,
	next: number,
	range: CaptureRange,
): boolean {
	return (
		(current >= range.start && current <= range.end) ||
		(current < range.start && next >= range.start) ||
		(current > range.end && next <= range.end)
	);
}

export interface ResponseGithubStageProps {
	forge: ForgeId | null;
	builder: BlockBuilder;
	check: CheckPreview;
	outputs: BlockOutput[];
	plan: SurfacePlan;
	posting: boolean;
	readOnly: boolean;
	edited: boolean;
	toolbar: ReactNode;
}

export function PullRequestHeader({
	forge = null,
}: {
	forge?: ForgeId | null;
} = {}) {
	return (
		<header className={LOCAL_APPEARANCE.node115_1}>
			<div className={LOCAL_APPEARANCE.node116_2}>
				<span className={LOCAL_APPEARANCE.node117_3}>
					<Icon icon={ChangeRequest} size={20} />
				</span>
				<div className={LOCAL_APPEARANCE.node120_4}>
					<p className={LOCAL_APPEARANCE.node121_5}>
						{forge === "github" ? "[ShanaBoo] test bounty" : "Sample output"}{" "}
						<span className={LOCAL_APPEARANCE.node123_6}>#231</span>
					</p>
					<div className={LOCAL_APPEARANCE.node125_7}>
						<Badge size="small" tone="success">
							Open
						</Badge>
						<span className={LOCAL_APPEARANCE.node129_8}>
							<strong className={LOCAL_APPEARANCE.node130_9}>
								genesisrevelationinc-debug
							</strong>{" "}
							wants to merge 1 commit into
							<span className={LOCAL_APPEARANCE.node134_10}>
								<code>main</code>
							</span>
							from
							<span className={LOCAL_APPEARANCE.node138_11}>
								<code>genesisrevelationinc-debug:shanaboo-fix-188</code>
							</span>
							<Icon icon={Copy} size={12} />
						</span>
					</div>
				</div>
			</div>
		</header>
	);
}

export function PullRequestNavigation({
	value,
	onValueChange,
}: {
	value?: GithubPreviewTab;
	onValueChange?: (value: GithubPreviewTab) => void;
} = {}) {
	const items = [
		{ value: "conversation", label: "Conversation", count: 2 },
		{ value: "checks", label: "Checks", count: 3 },
	] as const;
	const handleValueChange = (nextValue: string | null) => {
		if (nextValue === "conversation" || nextValue === "checks") {
			onValueChange?.(nextValue);
		}
	};
	const shared = {
		ariaLabel: "Pull request sections",
		items,
		onValueChange: handleValueChange,
		panelMode: "external" as const,
		size: "small" as const,
	};
	return value ? (
		<Tabs {...shared} value={value} />
	) : (
		<Tabs {...shared} defaultValue="conversation" />
	);
}

const CHECK_STATUS = {
	pass: { status: "ok", label: "Passing" },
	block: { status: "fail", label: "Failing" },
	changes_required: { status: "fail", label: "Failing" },
	close: { status: "fail", label: "Failing" },
	needs_review: { status: "running", label: "In progress" },
} satisfies Record<
	CheckPreview["verdict"],
	{ status: StatusValue; label: string }
>;

function checkOutputTitle(summary: string): string {
	const firstSentence = summary.match(/^[^.!?]+/)?.[0]?.trim();
	return firstSentence || "Tripwire check";
}

interface GithubCheckRowProps {
	name: string;
	description: string;
	status: StatusValue;
	selected?: boolean;
	tripwire?: boolean;
}

function GithubCheckRow({
	name,
	description,
	status,
	selected,
	tripwire,
}: GithubCheckRowProps) {
	return (
		<div
			className={cn(
				LOCAL_APPEARANCE.checkRow,
				selected && LOCAL_APPEARANCE.checkRowSelected,
			)}
		>
			<span className={LOCAL_APPEARANCE.node215_12}>
				{tripwire ? (
					<TripwireLogo size={16} />
				) : (
					<Icon icon={Checks} size={14} />
				)}
			</span>
			<div className={LOCAL_APPEARANCE.node222_13}>
				<p className={LOCAL_APPEARANCE.node223_14}>{name}</p>
				<p className={LOCAL_APPEARANCE.node224_15}>{description}</p>
			</div>
			<span className={LOCAL_APPEARANCE.node228_16}>
				<Status size="small" status={status}>
					<span className={LOCAL_APPEARANCE.node229_17}>{description}</span>
				</Status>
			</span>
		</div>
	);
}

export function GithubChecksPreview({
	check,
	forge = null,
}: {
	check: CheckPreview;
	forge?: ForgeId | null;
}) {
	const state = check.posted
		? CHECK_STATUS[check.verdict]
		: { status: "queued" as const, label: "Not posted" };
	const failing = state.status === "fail";
	const running = state.status === "running" || state.status === "queued";
	const summary = failing
		? "1 failing, 2 successful checks"
		: running
			? "1 in progress, 2 successful checks"
			: "3 successful checks";

	return (
		<section
			aria-label={
				forge ? `${FORGE_BY_ID[forge].label} checks` : "Sample checks"
			}
			className={LOCAL_APPEARANCE.node250_18}
		>
			<div className={LOCAL_APPEARANCE.node252_19}>
				<aside className={LOCAL_APPEARANCE.node253_20}>
					<h2 className={LOCAL_APPEARANCE.node254_21}>
						{forge === "github" ? "Checks" : "Sample checks"}
					</h2>
					<p className={LOCAL_APPEARANCE.node255_22}>{summary}</p>
					<div className={LOCAL_APPEARANCE.node256_23}>
						<GithubCheckRow
							description={state.label}
							name={CHECK_NAME}
							selected
							status={state.status}
							tripwire
						/>
						<GithubCheckRow
							description="Successful in 42s"
							name={forge === "github" ? "CodeQL / Analyze" : "Sample analysis"}
							status="ok"
						/>
						<GithubCheckRow
							description="Deployment ready"
							name={forge === "github" ? "Vercel / Preview" : "Sample preview"}
							status="ok"
						/>
					</div>
				</aside>
				<article className={LOCAL_APPEARANCE.node276_24}>
					<header className={LOCAL_APPEARANCE.node277_25}>
						<span className={LOCAL_APPEARANCE.node278_26}>
							<TripwireLogo size={20} />
						</span>
						<div className={LOCAL_APPEARANCE.node281_27}>
							<p className={LOCAL_APPEARANCE.node282_28}>{CHECK_NAME}</p>
							<Status size="small" status={state.status}>
								{state.label} {running ? "now" : "after 8s"}
							</Status>
						</div>
						<span className={LOCAL_APPEARANCE.node287_29}>
							Details
							<Icon icon={External} size={12} />
						</span>
					</header>
					<div className={LOCAL_APPEARANCE.node292_30}>
						<h3 className={LOCAL_APPEARANCE.node293_31}>
							{checkOutputTitle(check.summary)}
						</h3>
						<p className={LOCAL_APPEARANCE.node296_32}>{check.summary}</p>
						<div className={LOCAL_APPEARANCE.node299_33}>
							<span className={LOCAL_APPEARANCE.node300_34}>
								View details on Tripwire
								<Icon icon={External} size={14} />
							</span>
						</div>
					</div>
				</article>
			</div>
		</section>
	);
}

export function ContributorCommentPreview({
	forge = null,
}: {
	forge?: ForgeId | null;
} = {}) {
	return (
		<div className={LOCAL_APPEARANCE.node315_35} data-preview-step>
			<img
				alt="genesisrevelationinc-debug avatar"
				className={LOCAL_APPEARANCE.node320_36}
				height={40}
				src={CONTRIBUTOR_AVATAR}
				width={40}
			/>
			<article className={LOCAL_APPEARANCE.node325_37}>
				<header className={LOCAL_APPEARANCE.node326_38}>
					<strong className={LOCAL_APPEARANCE.node327_39}>
						genesisrevelationinc-debug
					</strong>
					<span className={LOCAL_APPEARANCE.node330_40}>19 hours ago</span>
					<Badge size="small" variant="outline">
						Contributor
					</Badge>
					<Icon icon={More} size={14} />
				</header>
				<div className={LOCAL_APPEARANCE.node336_41}>
					<p className={LOCAL_APPEARANCE.node337_42}>
						<Icon icon={ChevronDown} size={14} />
						ShanaBoo Autonomous Fix
					</p>
					<p>
						This PR was automatically generated by ShanaBoo Earn Engine to claim
						the <strong className={LOCAL_APPEARANCE.node343_43}>$100.00</strong>{" "}
						bounty on{" "}
						<span className={LOCAL_APPEARANCE.node344_44}>this issue</span>.
					</p>
					<p>
						{forge === "github"
							? "Source: GitHub | Task: 3918183660"
							: "Sample output | Task: 3918183660"}
					</p>
					<p>
						Closes
						<br />
						<span className={LOCAL_APPEARANCE.node350_45}>#188</span>
					</p>
					<p className={LOCAL_APPEARANCE.node352_46}>
						Auto-submitted by ShanaBoo CNS - NVIDIA NIM + Microsoft Agent
						Framework
					</p>
				</div>
			</article>
		</div>
	);
}

export function DeploymentPreview() {
	return (
		<section className={LOCAL_APPEARANCE.node365_47} data-preview-step>
			<div className={LOCAL_APPEARANCE.node368_48}>
				<span className={LOCAL_APPEARANCE.node369_49}>
					<Icon icon={Upload} size={16} />
				</span>
				<div>
					<p className={LOCAL_APPEARANCE.node373_50}>
						This branch has not been deployed
					</p>
					<p className={LOCAL_APPEARANCE.node376_51}>No deployments</p>
				</div>
			</div>
		</section>
	);
}

export function MergePreview() {
	return (
		<section
			aria-label="Merge status"
			className={LOCAL_APPEARANCE.node387_52}
			data-preview-step
		>
			<div className={LOCAL_APPEARANCE.node390_53}>
				<span className={LOCAL_APPEARANCE.node391_54}>
					<Icon icon={Conversation} size={16} />
				</span>
				<div className={LOCAL_APPEARANCE.node394_55}>
					<p className={LOCAL_APPEARANCE.node395_56}>Changes reviewed</p>
					<p className={LOCAL_APPEARANCE.node396_57}>
						No applicable reviews submitted by reviewers with write access.
					</p>
				</div>
				<Icon icon={ChevronDown} size={16} />
			</div>
			<div className={LOCAL_APPEARANCE.node402_58}>
				<div className={LOCAL_APPEARANCE.node403_59}>
					<Icon icon={Diff} size={14} tone="danger" />
					<span>1 requested change</span>
					<Icon icon={ChevronDown} size={12} />
				</div>
				<div className={LOCAL_APPEARANCE.node408_60}>
					<span className={LOCAL_APPEARANCE.node409_61}>
						<TripwireLogo size={14} />
					</span>
					<strong className={LOCAL_APPEARANCE.node412_62}>
						tripwire-sh[bot]
					</strong>
					<span>Requested changes with read-only permissions</span>
					<Icon icon={More} size={14} />
				</div>
				<div className={LOCAL_APPEARANCE.node418_63}>
					<span className={LOCAL_APPEARANCE.node419_64}>
						<Icon icon={Check} size={16} />
					</span>
					<div>
						<p className={LOCAL_APPEARANCE.node423_65}>
							No conflicts with base branch
						</p>
						<p className={LOCAL_APPEARANCE.node426_66}>
							Merging can be performed automatically.
						</p>
					</div>
				</div>
			</div>
			<footer className={LOCAL_APPEARANCE.node432_67}>
				<span className={LOCAL_APPEARANCE.node433_68}>
					<span className={LOCAL_APPEARANCE.node434_69}>
						Merge pull request
					</span>
					<span className={LOCAL_APPEARANCE.node437_70}>
						<Icon icon={ChevronDown} size={12} />
					</span>
				</span>
				<span className={LOCAL_APPEARANCE.node441_71}>
					You can also merge this with the command line.{" "}
					<u>View command line instructions.</u>
				</span>
			</footer>
		</section>
	);
}

export function ResponseGithubStage({
	forge,
	builder,
	check,
	outputs,
	plan,
	posting,
	readOnly,
	edited,
	toolbar,
}: ResponseGithubStageProps) {
	const reduceMotion = useReducedMotion();
	const [previewTab, setPreviewTab] =
		useState<GithubPreviewTab>("conversation");
	const scroll = useRef<HTMLDivElement>(null);
	const scrollMotion = useRef<ReturnType<typeof animate> | null>(null);
	const programmaticScroll = useRef(false);
	const initialSelection = useRef(true);
	const focusCaptureActive = useRef(false);
	const wheelAnimating = useRef(false);
	const queuedDirection = useRef<ScrollDirection | null>(null);
	const exitIntents = useRef(0);
	const releaseDirection = useRef<ScrollDirection | null>(null);
	const selectionFromWheel = useRef(false);
	const outputsRef = useRef(outputs);
	const selectedIdRef = useRef(builder.selectedId);
	const focusRef = useRef(builder.focus);
	const completeWheelStep = useRef<() => void>(() => undefined);
	const moveSelection = useRef<(direction: ScrollDirection) => void>(
		() => undefined,
	);
	outputsRef.current = outputs;
	selectedIdRef.current = builder.selectedId;
	focusRef.current = builder.focus;

	const setCapture = useCallback((root: HTMLDivElement, active: boolean) => {
		focusCaptureActive.current = active;
		root.toggleAttribute("data-scroll-captured", active);
		if (active) releaseDirection.current = null;
		if (!active) {
			queuedDirection.current = null;
			exitIntents.current = 0;
		}
	}, []);

	const scrollTo = useCallback(
		(root: HTMLDivElement, next: number, onComplete?: () => void) => {
			scrollMotion.current?.stop();
			if (reduceMotion) {
				root.scrollTop = next;
				onComplete?.();
				return;
			}
			programmaticScroll.current = true;
			const finish = () => {
				programmaticScroll.current = false;
				onComplete?.();
			};
			scrollMotion.current = animate(root.scrollTop, next, {
				type: "spring",
				stiffness: 320,
				damping: 36,
				mass: 0.9,
				restDelta: 0.5,
				restSpeed: 10,
				onComplete: finish,
				onUpdate: (value) => {
					root.scrollTop = value;
				},
			});
		},
		[reduceMotion],
	);

	completeWheelStep.current = () => {
		wheelAnimating.current = false;
		const queued = queuedDirection.current;
		queuedDirection.current = null;
		if (queued !== null && focusCaptureActive.current) {
			moveSelection.current(queued);
		}
	};

	moveSelection.current = (direction) => {
		const root = scroll.current;
		if (!root) return;
		const currentOutputs = outputsRef.current;
		const currentIndex = currentOutputs.findIndex(
			(output) => output.block.id === selectedIdRef.current,
		);
		const index =
			currentIndex < 0
				? direction > 0
					? -1
					: currentOutputs.length
				: currentIndex;
		const next = currentOutputs[index + direction];
		if (!next) {
			exitIntents.current += 1;
			if (exitIntents.current < EXIT_INTENTS_REQUIRED) return;
			const range = captureRange(root);
			setCapture(root, false);
			releaseDirection.current = direction;
			wheelAnimating.current = false;
			if (!range) return;
			const releaseTarget =
				direction > 0
					? range.end + CAPTURE_RELEASE_PADDING_PX
					: range.start - CAPTURE_RELEASE_PADDING_PX;
			scrollTo(root, clampScroll(root, releaseTarget));
			return;
		}
		exitIntents.current = 0;
		wheelAnimating.current = true;
		selectionFromWheel.current = true;
		selectedIdRef.current = next.block.id;
		focusRef.current(next.block.id);
	};

	const handleWheel = useCallback(
		(event: WheelEvent) => {
			if (event.ctrlKey || readOnly) return;
			const root = scroll.current;
			const direction = Math.sign(event.deltaY) as ScrollDirection | 0;
			if (!root || direction === 0 || outputsRef.current.length === 0) return;
			if (!focusCaptureActive.current) {
				const range = captureRange(root);
				if (!range) return;
				if (releaseDirection.current === direction) {
					if (programmaticScroll.current) {
						scrollMotion.current?.stop();
						programmaticScroll.current = false;
					}
					return;
				}
				releaseDirection.current = null;
				const projectedDelta = Math.min(
					Math.abs(event.deltaY),
					root.clientHeight * 0.75,
				);
				const projected = clampScroll(
					root,
					root.scrollTop + direction * projectedDelta,
				);
				if (!entersCaptureRange(root.scrollTop, projected, range)) {
					if (programmaticScroll.current) {
						scrollMotion.current?.stop();
						programmaticScroll.current = false;
					}
					return;
				}
				event.preventDefault();
				setCapture(root, true);
				const entry =
					direction > 0 ? outputsRef.current[0] : outputsRef.current.at(-1);
				if (!entry) return;
				exitIntents.current = 0;
				wheelAnimating.current = true;
				selectionFromWheel.current = true;
				selectedIdRef.current = entry.block.id;
				if (builder.selectedId === entry.block.id) {
					const target = root.querySelector<HTMLElement>(
						`[data-block-id="${CSS.escape(entry.block.id)}"]`,
					);
					if (target) {
						scrollTo(root, targetScrollTop(root, target), () =>
							completeWheelStep.current(),
						);
					} else {
						completeWheelStep.current();
					}
				} else {
					focusRef.current(entry.block.id);
				}
				return;
			}

			event.preventDefault();
			if (wheelAnimating.current) {
				queuedDirection.current = direction;
				return;
			}
			moveSelection.current(direction);
		},
		[builder.selectedId, readOnly, scrollTo, setCapture],
	);

	useEffect(() => {
		const root = scroll.current;
		if (!root) return;
		root.addEventListener("wheel", handleWheel, { passive: false });
		return () => root.removeEventListener("wheel", handleWheel);
	}, [handleWheel]);

	useEffect(() => {
		if (initialSelection.current) {
			initialSelection.current = false;
			return;
		}
		const root = scroll.current;
		const target = root?.querySelector<HTMLElement>(
			`[data-block-id="${CSS.escape(builder.selectedId ?? "")}"]`,
		);
		if (!(root && target)) return;
		const fromWheel = selectionFromWheel.current;
		selectionFromWheel.current = false;
		scrollTo(
			root,
			targetScrollTop(root, target),
			fromWheel ? () => completeWheelStep.current() : undefined,
		);
	}, [builder.selectedId, scrollTo]);

	useEffect(
		() => () => {
			scrollMotion.current?.stop();
			programmaticScroll.current = false;
		},
		[],
	);

	return (
		<section
			aria-label={
				forge
					? `${FORGE_BY_ID[forge].label} response preview`
					: "Response preview"
			}
			className={LOCAL_APPEARANCE.node673_72}
		>
			<div aria-hidden className={LOCAL_APPEARANCE.node677_73} />
			<div aria-hidden className={LOCAL_APPEARANCE.node681_74} />
			{toolbar ? (
				<div
					className={LOCAL_APPEARANCE.node685_75}
					data-layout-role="response-save-toolbar"
				>
					{toolbar}
				</div>
			) : null}
			<div
				className={LOCAL_APPEARANCE.node692_76}
				onScroll={() => {
					if (programmaticScroll.current) return;
					const root = scroll.current;
					if (!(root && focusCaptureActive.current)) return;
					const range = captureRange(root);
					if (
						!range ||
						root.scrollTop < range.start - CAPTURE_RELEASE_PADDING_PX ||
						root.scrollTop > range.end + CAPTURE_RELEASE_PADDING_PX
					) {
						setCapture(root, false);
					}
				}}
				ref={scroll}
			>
				<div className={LOCAL_APPEARANCE.node708_77}>
					<PullRequestHeader forge={forge} />
					<div className={LOCAL_APPEARANCE.node710_78}>
						<PullRequestNavigation
							onValueChange={setPreviewTab}
							value={previewTab}
						/>
					</div>
					<AnimatePresence initial={false} mode="wait">
						{previewTab === "conversation" ? (
							<div key="conversation">
								<motion.div
									animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
									className={LOCAL_APPEARANCE.node721_79}
									exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
									initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
									transition={{
										duration: reduceMotion ? 0 : 0.18,
										ease: [0.16, 1, 0.3, 1],
									}}
								>
									<ContributorCommentPreview forge={forge} />
									<div
										className={LOCAL_APPEARANCE.node731_80}
										data-preview-target="response-blocks"
									>
										<GithubCommentMock
											action={
												posting && plan.comment !== "upsert"
													? "review"
													: "comment"
											}
											body={posting ? "" : null}
											edited={edited}
											editor={
												<BlockCanvas
													builder={builder}
													outputs={outputs}
													readOnly={readOnly}
												/>
											}
										/>
									</div>
									{plan.review !== null ? (
										<div
											className={LOCAL_APPEARANCE.node753_81}
											data-preview-step
											data-preview-target="review"
										>
											<GithubCommentMock action="review" body={plan.review} />
										</div>
									) : null}
									{plan.review !== null ? <DeploymentPreview /> : null}
									{plan.review !== null ? <MergePreview /> : null}
								</motion.div>
							</div>
						) : (
							<div key="checks">
								<motion.div
									animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
									className={LOCAL_APPEARANCE.node768_82}
									exit={{ opacity: 0, y: 4, filter: "blur(4px)" }}
									initial={{ opacity: 0, y: -4, filter: "blur(4px)" }}
									transition={{
										duration: reduceMotion ? 0 : 0.18,
										ease: [0.16, 1, 0.3, 1],
									}}
								>
									<GithubChecksPreview check={check} forge={forge} />
								</motion.div>
							</div>
						)}
					</AnimatePresence>
				</div>
			</div>
		</section>
	);
}
