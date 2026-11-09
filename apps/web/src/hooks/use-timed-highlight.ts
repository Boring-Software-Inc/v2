import { useEffect, useState } from "react";

export function useTimedHighlight(
	startedAt: number | undefined,
	durationMs: number,
) {
	const [clock, setClock] = useState(Date.now);
	const expiresAt = startedAt === undefined ? 0 : startedAt + durationMs;

	useEffect(() => {
		if (!expiresAt) return;
		const timeout = setTimeout(
			() => setClock(expiresAt),
			Math.max(0, expiresAt - Date.now()),
		);
		return () => clearTimeout(timeout);
	}, [expiresAt]);

	return expiresAt > clock;
}
