import { type WorkflowWork, workSettlesIn } from "@tripwire/contracts";
import { useEffect, useState } from "react";

/**
 * The time to judge agent presence by. It ticks when the work changes and
 * again when the next outline or presence is due to clear.
 */
export function useWorkClock(
	work: Pick<WorkflowWork, "agents"> | null | undefined,
): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		setNow(new Date());
	}, [work]);
	useEffect(() => {
		const wait = workSettlesIn(work, now);
		if (wait === null) {
			return;
		}
		const timer = setTimeout(() => setNow(new Date()), wait + 50);
		return () => clearTimeout(timer);
	}, [work, now]);
	return now;
}
