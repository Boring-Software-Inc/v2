import { Button } from "@tripwire/ui/button";
import { ChevronLeft, ChevronRight, Icon } from "@tripwire/ui/icon";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";

type SidePanelState = {
	content: ReactNode | null;
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
		<span className="absolute end-1 top-1/2 hidden -translate-y-1/2 md:inline-flex">
			<Button
				ariaLabel={collapsed ? "Show details" : "Hide details"}
				onAction={toggle}
				size="small"
				variant="ghost"
			>
				<Icon icon={collapsed ? ChevronLeft : ChevronRight} />
			</Button>
		</span>
	);
}
