import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import type { FeedbackElementSummary } from "./pick";

export type FeedbackPhase = "closed" | "picking" | "open";

export interface PickedElement {
	element: HTMLElement;
	name: string;
	summary: FeedbackElementSummary;
}

export interface FeedbackConfig {
	metadata?: Record<string, string>;
}

export interface FeedbackContextType {
	phase: FeedbackPhase;
	picked: PickedElement | null;
	draft: string;
	setDraft: (value: string) => void;
	start: () => void;
	pick: (picked: PickedElement | null) => void;
	pickAgain: () => void;
	cancelPicking: () => void;
	close: () => void;
	config: FeedbackConfig;
}

const FeedbackContext = createContext<FeedbackContextType | null>(null);

const EMPTY_CONFIG: FeedbackConfig = {};

function restoreFocus(target: Element | null) {
	if (target instanceof HTMLElement && target.isConnected) {
		target.focus({ preventScroll: true });
	}
}

export function FeedbackProvider({
	children,
	config = EMPTY_CONFIG,
}: {
	children: ReactNode;
	config?: FeedbackConfig;
}) {
	const [phase, setPhase] = useState<FeedbackPhase>("closed");
	const [picked, setPicked] = useState<PickedElement | null>(null);
	const [draft, setDraft] = useState("");
	const [resumable, setResumable] = useState(false);
	const returnFocus = useRef<Element | null>(null);

	const start = useCallback(() => {
		returnFocus.current = document.activeElement;
		setPicked(null);
		setResumable(false);
		setPhase("picking");
	}, []);

	const pick = useCallback((next: PickedElement | null) => {
		setPicked(next);
		setPhase("open");
	}, []);

	const pickAgain = useCallback(() => {
		setResumable(true);
		setPhase("picking");
	}, []);

	const close = useCallback(() => {
		setPhase("closed");
		setPicked(null);
		setDraft("");
		setResumable(false);
		const target = returnFocus.current;
		returnFocus.current = null;
		requestAnimationFrame(() => restoreFocus(target));
	}, []);

	const cancelPicking = useCallback(() => {
		if (resumable) {
			setPhase("open");
			return;
		}
		close();
	}, [resumable, close]);

	const value = useMemo<FeedbackContextType>(
		() => ({
			phase,
			picked,
			draft,
			setDraft,
			start,
			pick,
			pickAgain,
			cancelPicking,
			close,
			config,
		}),
		[
			phase,
			picked,
			draft,
			start,
			pick,
			pickAgain,
			cancelPicking,
			close,
			config,
		],
	);

	return (
		<FeedbackContext.Provider value={value}>
			{children}
		</FeedbackContext.Provider>
	);
}

export function useFeedback(): FeedbackContextType {
	const ctx = useContext(FeedbackContext);
	if (!ctx) {
		throw new Error("useFeedback must be used within <FeedbackProvider>");
	}
	return ctx;
}
