import { Dialog } from "@tripwire/ui/dialog";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

type RequestAgentConfirmation = (
	summary: string,
	signal: AbortSignal,
) => Promise<boolean>;

const missingProvider: RequestAgentConfirmation = () => {
	throw new Error("Agent actions require AgentConfirmationProvider.");
};

const AgentConfirmationContext =
	createContext<RequestAgentConfirmation>(missingProvider);

interface PendingAgentConfirmation {
	summary: string;
	signal: AbortSignal;
	onAbort: () => void;
	resolve: (approved: boolean) => void;
}

export function AgentConfirmationProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [pending, setPending] = useState<PendingAgentConfirmation | null>(null);
	const pendingRef = useRef<PendingAgentConfirmation | null>(null);

	const settle = useCallback((approved: boolean) => {
		const current = pendingRef.current;
		if (!current) return;
		pendingRef.current = null;
		current.signal.removeEventListener("abort", current.onAbort);
		current.resolve(approved);
		setPending(null);
	}, []);

	const requestConfirmation = useCallback<RequestAgentConfirmation>(
		(summary, signal) => {
			if (signal.aborted) return Promise.resolve(false);
			settle(false);

			return new Promise<boolean>((resolve) => {
				const request: PendingAgentConfirmation = {
					summary,
					signal,
					resolve,
					onAbort: () => {
						if (pendingRef.current === request) settle(false);
					},
				};
				pendingRef.current = request;
				setPending(request);
				signal.addEventListener("abort", request.onAbort, { once: true });
			});
		},
		[settle],
	);
	const value = useMemo(() => requestConfirmation, [requestConfirmation]);

	return (
		<AgentConfirmationContext value={value}>
			{children}
			<Dialog
				action={{
					label: "Allow",
					onAction: ({ source }) => settle(source !== "agent"),
				}}
				agentVisibility="hidden"
				description={pending?.summary}
				onOpenChange={(open) => {
					if (!open) settle(false);
				}}
				open={pending !== null}
				title="Allow agent action?"
			>
				{null}
			</Dialog>
		</AgentConfirmationContext>
	);
}

export function useAgentConfirmation(): RequestAgentConfirmation {
	return useContext(AgentConfirmationContext);
}
