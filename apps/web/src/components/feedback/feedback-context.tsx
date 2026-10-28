import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useReducer,
	useRef,
} from "react";
import {
	type FeedbackPhase,
	feedbackReducer,
	initialFeedbackState,
} from "./feedback-state";
import type { FeedbackElementSummary } from "./pick";

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
	session: number;
	setDraft: (value: string) => void;
	start: () => void;
	pick: (picked: PickedElement | null) => void;
	pickAgain: () => void;
	cancelPicking: () => void;
	close: () => void;
	finish: (session: number) => void;
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
	const [state, dispatch] = useReducer(
		feedbackReducer<PickedElement>,
		undefined,
		initialFeedbackState<PickedElement>,
	);
	const sessionRef = useRef(state.session);
	sessionRef.current = state.session;
	const resumableRef = useRef(state.resumable);
	resumableRef.current = state.resumable;
	const returnFocus = useRef<Element | null>(null);

	const returnFocusSoon = useCallback(() => {
		const target = returnFocus.current;
		returnFocus.current = null;
		requestAnimationFrame(() => restoreFocus(target));
	}, []);

	const start = useCallback(() => {
		returnFocus.current = document.activeElement;
		dispatch({ type: "start" });
	}, []);

	const pick = useCallback((picked: PickedElement | null) => {
		dispatch({ type: "pick", picked });
	}, []);

	const pickAgain = useCallback(() => {
		dispatch({ type: "pick-again" });
	}, []);

	const setDraft = useCallback((value: string) => {
		dispatch({ type: "draft", value });
	}, []);

	const close = useCallback(() => {
		dispatch({ type: "close" });
		returnFocusSoon();
	}, [returnFocusSoon]);

	const cancelPicking = useCallback(() => {
		const resumable = resumableRef.current;
		dispatch({ type: "cancel-picking" });
		if (!resumable) {
			returnFocusSoon();
		}
	}, [returnFocusSoon]);

	const finish = useCallback(
		(session: number) => {
			if (session !== sessionRef.current) {
				return;
			}
			dispatch({ type: "finish", session });
			returnFocusSoon();
		},
		[returnFocusSoon],
	);

	const value = useMemo<FeedbackContextType>(
		() => ({
			phase: state.phase,
			picked: state.picked,
			draft: state.draft,
			session: state.session,
			setDraft,
			start,
			pick,
			pickAgain,
			cancelPicking,
			close,
			finish,
			config,
		}),
		[
			state,
			setDraft,
			start,
			pick,
			pickAgain,
			cancelPicking,
			close,
			finish,
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
