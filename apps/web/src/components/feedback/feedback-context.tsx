import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

/**
 * Feedback flow ported from ~/tripwire's `@tripwire/feedback` into apps/web
 * (web-only surface — no new package). Provider holds the open/selecting state
 * and the grabbed element context; the overlay writes into it, the form reads
 * from it. See [[feedback-overlay]] and [[feedback-form]].
 *
 * Mirrors react-grab/primitives' element context shape locally so the bundler
 * never has to resolve its deep types at this layer.
 */
export interface ReactGrabElementContext {
	element: Element;
	htmlPreview: string;
	stackString: string;
	stack: Array<{
		args?: unknown[];
		columnNumber?: number;
		lineNumber?: number;
		fileName?: string;
		functionName?: string;
		source?: string;
		isServer?: boolean;
		isSymbolicated?: boolean;
	}>;
	componentName: string | null;
	fiber: unknown;
	selector: string | null;
	styles: string;
}

export interface FeedbackConfig {
	/** Attached to every submission (e.g. the signed-in maintainer). */
	metadata?: Record<string, string>;
	ui?: {
		title?: string;
		description?: string;
		placeholder?: string;
		submitLabel?: string;
		cancelLabel?: string;
	};
}

export interface FeedbackContextType {
	isOpen: boolean;
	isSelecting: boolean;
	elementContext: ReactGrabElementContext | null;
	screenshotBlob: Blob | null;
	open: () => void;
	close: () => void;
	startSelection: () => void;
	cancelSelection: () => void;
	selectElement: (
		context: ReactGrabElementContext,
		screenshot?: Blob | null,
	) => void;
	setScreenshot: (blob: Blob | null) => void;
	config: FeedbackConfig;
}

const FeedbackContext = createContext<FeedbackContextType | null>(null);

const EMPTY_CONFIG: FeedbackConfig = {};

export function FeedbackProvider({
	children,
	config = EMPTY_CONFIG,
}: {
	children: ReactNode;
	config?: FeedbackConfig;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [isSelecting, setIsSelecting] = useState(false);
	const [elementContext, setElementContext] =
		useState<ReactGrabElementContext | null>(null);
	const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null);

	const open = useCallback(() => {
		setIsOpen(true);
		setIsSelecting(false);
	}, []);

	const close = useCallback(() => {
		setIsOpen(false);
		setElementContext(null);
		setScreenshotBlob(null);
		setIsSelecting(false);
	}, []);

	const startSelection = useCallback(() => {
		setIsSelecting(true);
		setIsOpen(false);
	}, []);

	const cancelSelection = useCallback(() => {
		setIsSelecting(false);
	}, []);

	const selectElement = useCallback(
		(context: ReactGrabElementContext, screenshot?: Blob | null) => {
			setElementContext(context);
			setScreenshotBlob(screenshot ?? null);
			setIsSelecting(false);
			setIsOpen(true);
		},
		[],
	);

	const setScreenshot = useCallback((blob: Blob | null) => {
		setScreenshotBlob(blob);
	}, []);

	const value = useMemo<FeedbackContextType>(
		() => ({
			isOpen,
			isSelecting,
			elementContext,
			screenshotBlob,
			open,
			close,
			startSelection,
			cancelSelection,
			selectElement,
			setScreenshot,
			config,
		}),
		[
			isOpen,
			isSelecting,
			elementContext,
			screenshotBlob,
			open,
			close,
			startSelection,
			cancelSelection,
			selectElement,
			setScreenshot,
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

/** The DOM/react-grab element context reduced to the server-fn payload shape. */
export function toFeedbackElement(ctx: ReactGrabElementContext) {
	return {
		componentName: ctx.componentName,
		selector: ctx.selector,
		htmlPreview: ctx.htmlPreview,
		stack: ctx.stack.map((frame) => ({
			functionName: frame.functionName ?? null,
			fileName: frame.fileName ?? null,
			lineNumber: frame.lineNumber ?? null,
			columnNumber: frame.columnNumber ?? null,
		})),
	};
}
