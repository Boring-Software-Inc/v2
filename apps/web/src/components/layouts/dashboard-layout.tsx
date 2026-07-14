import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { DevPersonaSwitcher } from "#/components/dev/persona-switcher";
import {
	FeedbackDialog,
	FeedbackOverlay,
	FeedbackProvider,
} from "#/components/feedback";
import { useMediaQuery } from "#/hooks/use-media-query";
import { currentUserQueryOptions } from "#/lib/auth.query";
import { BetaBanner } from "./beta-banner";
import {
	SIDE_PANEL_WIDTH,
	SidePanelProvider,
	SidePanelToggle,
	useSidePanel,
} from "./dashboard-side-panel";
import { DashboardTopbar } from "./dashboard-topbar";
import { MobileFooter } from "./mobile-footer";

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
			<DashboardShell {...props} />
		</SidePanelProvider>
	);
}

function DashboardShell({ counts, children }: DashboardLayoutProps) {
	const { data: user } = useQuery(currentUserQueryOptions());
	const { content, collapsed } = useSidePanel();
	const isDesktop = useMediaQuery("(min-width: 768px)");
	const showPanel = isDesktop && Boolean(content) && !collapsed;

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

	return (
		<FeedbackProvider config={feedbackConfig}>
			<div className="isolate flex h-dvh flex-col bg-muted">
				<DashboardTopbar user={user ?? null} counts={counts} />

				<motion.div
					initial={false}
					animate={{
						gridTemplateColumns: showPanel
							? `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}px`
							: "minmax(0, 1fr) 0px",
					}}
					transition={{ type: "spring", stiffness: 400, damping: 35 }}
					className="grid flex-1 overflow-hidden p-2 pt-0"
				>
					<div className="relative flex h-full flex-col overflow-hidden rounded-xl bg-card">
						<BetaBanner />
						{/* The shell owns page scroll: this container scrolls full-width so
					    the whole page area (not just a centered column) is a scroll +
					    hover target. Pages render natural-height content; they must NOT
					    add their own `overflow-stable`/`h-full` scroll wrapper. */}
						<div ref={pageRef} className="overflow-stable min-h-0 flex-1">
							{children}
						</div>

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
					</div>

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
			</div>
			<FeedbackOverlay />
			<FeedbackDialog />
		</FeedbackProvider>
	);
}
