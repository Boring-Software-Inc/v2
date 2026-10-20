import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";
import { ChevronLeft, ChevronRight, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";

type SidePanelState = {
	content: ReactNode | null;
	/** Identifies the open subject so rows can render an active state. */
	activeKey: string | null;
	collapsed: boolean;
	open: (key: string, content: ReactNode) => void;
	close: () => void;
	toggle: () => void;
};

const SidePanelContext = createContext<SidePanelState | null>(null);

export function useSidePanel() {
	const ctx = useContext(SidePanelContext);
	if (!ctx) {
		throw new Error("useSidePanel must be used within a SidePanelProvider");
	}
	return ctx;
}

export function SidePanelProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<{
		key: string | null;
		content: ReactNode | null;
	}>({ key: null, content: null });
	const [collapsed, setCollapsed] = useState(false);

	const open = useCallback((key: string, content: ReactNode) => {
		setState({ key, content });
		setCollapsed(false);
	}, []);
	const close = useCallback(() => setState({ key: null, content: null }), []);
	const toggle = useCallback(() => setCollapsed((c) => !c), []);

	return (
		<SidePanelContext
			value={{
				content: state.content,
				activeKey: state.key,
				collapsed,
				open,
				close,
				toggle,
			}}
		>
			{children}
		</SidePanelContext>
	);
}

export function SidePanelToggle() {
	const { content, collapsed, toggle } = useSidePanel();
	if (!content) return null;

	return (
		<Button
			aria-label={collapsed ? "Show details" : "Hide details"}
			className="absolute end-1 top-1/2 hidden -translate-y-1/2 md:inline-flex"
			onClick={toggle}
			size="icon-sm"
			variant="ghost"
		>
			<Icon icon={collapsed ? ChevronLeft : ChevronRight} size={12} />
		</Button>
	);
}
