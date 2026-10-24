import { type WorkflowWork, workSettlesIn } from "@tripwire/contracts";
import { useEffect, useState } from "react";

type Work = Pick<WorkflowWork, "agents"> | null | undefined;

/**
 * The time to judge agent presence by. It moves when the work changes and
 * again when the next outline or presence is due to clear.
 */
export function useWorkClock(work: Work): Date {
	const [clock, setClock] = useState(() => ({ work, now: new Date() }));
	if (clock.work !== work) {
		setClock({ work, now: new Date() });
	}
	const now = clock.now;
	useEffect(() => {
		const wait = workSettlesIn(work, now);
		if (wait === null) {
			return;
		}
		const timer = setTimeout(
			() => setClock({ work, now: new Date() }),
			wait + 50,
		);
		return () => clearTimeout(timer);
	}, [work, now]);
	return now;
}
