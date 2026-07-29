import { AnimatePresence, motion } from "motion/react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { cn } from "#/lib/utils";

const INSET_DIALOG_SPRING = {
	type: "spring",
	stiffness: 360,
	damping: 38,
} as const;

interface InsetDialogContextValue {
	openCount: number;
	setOpen: (id: string, open: boolean) => void;
}

const InsetDialogContext = createContext<InsetDialogContextValue | null>(null);

/**
 * Tracks whether any inset dialog is presented so the page shell can recede
 * behind it (scale down + drop — the sheet takes importance). Mount once around
 * the shell; the shell reads [[useInsetDialogPresence]].
 */
export function InsetDialogProvider({ children }: { children: ReactNode }) {
	const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
	const setOpen = useCallback((id: string, open: boolean) => {
		setOpenIds((prev) => {
			if (prev.has(id) === open) {
				return prev;
			}
			const next = new Set(prev);
			if (open) {
				next.add(id);
			} else {
				next.delete(id);
			}
			return next;
		});
	}, []);
	const value = useMemo(
		() => ({ openCount: openIds.size, setOpen }),
		[openIds, setOpen],
	);
	return (
		<InsetDialogContext.Provider value={value}>
			{children}
		</InsetDialogContext.Provider>
	);
}

/** True while any inset dialog is open — drive the shell's recede off this. */
export function useInsetDialogPresence(): boolean {
	return (useContext(InsetDialogContext)?.openCount ?? 0) > 0;
}

interface InsetDialogProps {
	open: boolean;
	onClose: () => void;
	children: ReactNode;
	/** Sizing overrides — width/height caps land here (default max-w-xl). */
	className?: string;
	/** Id of the heading that names the dialog. Prefer this over `label`. */
	labelledBy?: string;
	/** Fallback name when no visible heading exists. */
	label?: string;
}

const FOCUSABLE =
	'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Inset dialog — a bottom-attached sheet with a fixed width (not full-bleed).
 * It springs up from the bottom edge; the backdrop dims the page, which recedes
 * via [[InsetDialogProvider]]. Esc, backdrop click, or the caller's own close
 * affordance dismiss it. The bottom edge stays glued to the viewport bottom, so
 * only the top corners are rounded.
 */
export function InsetDialog({
	open,
	onClose,
	children,
	className,
	labelledBy,
	label,
}: InsetDialogProps) {
	const id = useId();
	const ctx = useContext(InsetDialogContext);
	const setOpen = ctx?.setOpen;
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setOpen?.(id, open);
		return () => setOpen?.(id, false);
	}, [id, open, setOpen]);

	// Focus moves into the sheet on open and returns to whatever opened it on
	// close; without the restore, dismissing drops focus onto <body> and a
	// keyboard user restarts from the top of the page.
	useEffect(() => {
		if (!open) {
			return;
		}
		const restoreTo = document.activeElement as HTMLElement | null;
		const panel = panelRef.current;
		const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
		(first ?? panel)?.focus();
		return () => restoreTo?.focus?.();
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
				return;
			}
			// Trap Tab inside the sheet — the page behind it is presentationally
			// gone, so focus must not walk into it.
			if (event.key !== "Tab") {
				return;
			}
			const panel = panelRef.current;
			if (!panel) {
				return;
			}
			const items = Array.from(
				panel.querySelectorAll<HTMLElement>(FOCUSABLE),
			).filter((el) => el.offsetParent !== null);
			if (items.length === 0) {
				event.preventDefault();
				panel.focus();
				return;
			}
			const first = items[0];
			const last = items[items.length - 1];
			const active = document.activeElement;
			if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			} else if (event.shiftKey && (active === first || active === panel)) {
				event.preventDefault();
				last.focus();
			} else if (!panel.contains(active)) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	return (
		<AnimatePresence>
			{open ? (
				<div className="fixed inset-0 z-50">
					{/* Presentational: Esc and the sheet's own close control are the
					    keyboard paths out, so the backdrop stays out of the tab order
					    rather than becoming a viewport-sized "Close" stop. */}
					<motion.div
						animate={{ opacity: 1 }}
						aria-hidden="true"
						className="absolute inset-0 bg-background/60"
						exit={{ opacity: 0 }}
						initial={{ opacity: 0 }}
						onClick={onClose}
						transition={{ duration: 0.2 }}
					/>
					<div className="pointer-events-none absolute inset-0 flex items-end justify-center px-3 md:px-0">
						<motion.div
							animate={{ y: 0 }}
							aria-label={labelledBy ? undefined : label}
							aria-labelledby={labelledBy}
							aria-modal="true"
							className={cn(
								"pointer-events-auto flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden overscroll-contain rounded-t-xl border border-b-0 bg-popover shadow-lg outline-none",
								className,
							)}
							exit={{ y: "110%" }}
							initial={{ y: "110%" }}
							ref={panelRef}
							role="dialog"
							tabIndex={-1}
							transition={INSET_DIALOG_SPRING}
						>
							{children}
						</motion.div>
					</div>
				</div>
			) : null}
		</AnimatePresence>
	);
}
