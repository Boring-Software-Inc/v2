import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { DevPersonaSwitcher } from "#/components/dev/persona-switcher";
import {
	FeedbackDialog,
	FeedbackOverlay,
	FeedbackProvider,
} from "#/components/feedback";
import { OrgSettingsDialog } from "#/components/organizations/org-settings-dialog";
import {
	InsetDialogProvider,
	useInsetDialogPresence,
} from "#/components/ui/inset-dialog";
import { useMediaQuery } from "#/hooks/use-media-query";
import { currentUserQueryOptions } from "#/lib/auth.query";
import { cn } from "#/lib/utils";
import { BetaBanner } from "./beta-banner";
import {
	SIDE_PANEL_WIDTH,
	SidePanelProvider,
	SidePanelToggle,
	useSidePanel,
} from "./dashboard-side-panel";
import { DashboardTopbar } from "./dashboard-topbar";
import { MobileFooter } from "./mobile-footer";
import { RouteProgress } from "./route-progress";

interface DashboardLayoutProps {
	counts: { queue?: number };
	children: ReactNode;
}

const SHEET_SPRING = { type: "spring", stiffness: 360, damping: 38 } as const;
// Concave corner fillets so the sheet's top curves up into the inset.
const FILLET_LEFT =
	"radial-gradient(circle 14px at top right, transparent 13px, #000 14px)";
const FILLET_RIGHT =
	"radial-gradient(circle 14px at top left, transparent 13px, #000 14px)";

export function DashboardLayout(props: DashboardLayoutProps) {
	return (
		<SidePanelProvider>
			<InsetDialogProvider>
				<DashboardShell {...props} />
			</InsetDialogProvider>
		</SidePanelProvider>
	);
}

function DashboardShell({ counts, children }: DashboardLayoutProps) {
	const { data: user } = useQuery(currentUserQueryOptions());
	const { content, collapsed } = useSidePanel();
	const isDesktop = useMediaQuery("(min-width: 768px)");
	const showPanel = isDesktop && Boolean(content) && !collapsed;

	// The page area is a floating inset (padding + rounded card on the muted
	// backdrop) only once you're inside a repo. Org-level pages — Home first —
	// push flush to the top edge; entering a repo route animates the inset in.
	const params = useParams({ strict: false });
	const inset = Boolean(params.repo);

	// Opening the mobile sheet rides the page scroll to the bottom (content
	// slides up); closing glides it back to wherever they opened it from.
	const pageRef = useRef<HTMLDivElement>(null);
	const restoreTop = useRef(0);
	const hadContent = useRef(false);
	useEffect(() => {
		const open = Boolean(content);
		if (isDesktop) {
			hadContent.current = open;
			return;
		}
		const scroller =
			pageRef.current?.querySelector<HTMLElement>(".overflow-stable") ??
			pageRef.current;
		const opening = open && !hadContent.current;
		const closing = !open && hadContent.current;
		hadContent.current = open;
		if (!scroller || (!opening && !closing)) return;

		if (opening) restoreTop.current = scroller.scrollTop;
		const target = opening
			? () => scroller.scrollHeight
			: () => restoreTop.current;

		let raf = 0;
		let start = 0;
		const tick = (now: number) => {
			start ||= now;
			scroller.scrollTop = target();
			if (now - start < 540) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [content, isDesktop]);

	const feedbackConfig = useMemo(
		() => ({ metadata: user?.login ? { user: user.login } : undefined }),
		[user?.login],
	);

	// An open inset dialog pushes the whole shell down-and-away (scale + drop)
	// so the sheet reads as the foreground surface. The dialog itself is fixed
	// and rendered OUTSIDE this wrapper — a transformed ancestor would break
	// its viewport positioning.
	const receded = useInsetDialogPresence();

	return (
		<FeedbackProvider config={feedbackConfig}>
			<motion.div
				animate={{ scale: receded ? 0.98 : 1, y: receded ? 12 : 0 }}
				transition={SHEET_SPRING}
				className={cn(
					"isolate flex h-dvh flex-col transition-colors duration-300",
					// Inside a repo the shell is the muted backdrop the page floats on;
					// on org pages (Home) it matches the card so the topbar blends away.
					inset ? "bg-background" : "bg-surface-1",
				)}
			>
				{/* First focusable element on every dashboard page — the topbar and
				    repo nav sit ahead of the content on each route, so keyboard
				    users get one jump past them. */}
				{/* Parked off-screen and slid in on focus, rather than `sr-only`:
				    react-grab writes an inline `clip-path` onto elements, which beats
				    the utility's clipping and leaves the link visible in the corner.
				    Translation can't be defeated the same way. */}
				<a
					href="#main-content"
					className="-translate-y-20 fixed top-2 left-2 z-50 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm transition-transform focus:translate-y-0"
				>
					Skip to content
				</a>
				<DashboardTopbar user={user ?? null} />
				<RouteProgress />

				<motion.div
					initial={false}
					animate={{
						gridTemplateColumns: showPanel
							? `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}px`
							: "minmax(0, 1fr) 0px",
						paddingLeft: inset ? 8 : 0,
						paddingRight: inset ? 8 : 0,
						paddingBottom: inset ? 8 : 0,
					}}
					transition={{
						gridTemplateColumns: {
							type: "spring",
							stiffness: 400,
							damping: 35,
						},
						default: SHEET_SPRING,
					}}
					className="grid flex-1 overflow-hidden pt-0"
				>
					<motion.div
						initial={false}
						animate={{ borderRadius: inset ? 12 : 0 }}
						transition={SHEET_SPRING}
						className="relative flex h-full flex-col overflow-hidden bg-surface-1"
					>
						<BetaBanner />
						{/* The shell owns page scroll: this container scrolls full-width so
					    the whole page area (not just a centered column) is a scroll +
					    hover target. Pages render natural-height content; they must NOT
					    add their own `overflow-stable`/`h-full` scroll wrapper. */}
						<main
							id="main-content"
							tabIndex={-1}
							ref={pageRef}
							className="overflow-stable min-h-0 flex-1 outline-none"
						>
							{children}
						</main>

						{/* Below xl the side panel can't show — surface its content as a
					    push-up bottom sheet, mirroring the analytics metrics sheet. */}
						{isDesktop ? null : (
							<div className="relative shrink-0">
								{content ? (
									<>
										<span
											aria-hidden
											className="pointer-events-none absolute top-0 left-0 size-3.5 -translate-y-full bg-muted"
											style={{
												maskImage: FILLET_LEFT,
												WebkitMaskImage: FILLET_LEFT,
											}}
										/>
										<span
											aria-hidden
											className="pointer-events-none absolute top-0 right-0 size-3.5 -translate-y-full bg-muted"
											style={{
												maskImage: FILLET_RIGHT,
												WebkitMaskImage: FILLET_RIGHT,
											}}
										/>
									</>
								) : null}
								<motion.div
									initial={false}
									animate={{ height: content ? "auto" : 0 }}
									transition={SHEET_SPRING}
									className="overflow-hidden bg-muted"
								>
									<div className="max-h-[86dvh] min-h-[58dvh] overflow-y-auto">
										{content}
									</div>
								</motion.div>
							</div>
						)}

						<SidePanelToggle />
					</motion.div>

					<div className="hidden overflow-hidden md:block">
						<motion.div
							animate={{ opacity: showPanel ? 1 : 0 }}
							transition={{
								duration: showPanel ? 0.2 : 0.1,
								delay: showPanel ? 0.1 : 0,
							}}
							className="h-full overflow-y-auto overflow-x-hidden pb-2 pl-2"
						>
							{isDesktop ? content : null}
						</motion.div>
					</div>
				</motion.div>

				<MobileFooter counts={counts} />
				<DevPersonaSwitcher />
			</motion.div>
			<OrgSettingsDialog />
			<FeedbackOverlay />
			<FeedbackDialog />
		</FeedbackProvider>
	);
}
