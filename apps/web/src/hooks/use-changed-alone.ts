import { useState } from "react";

export function useChangedAlone<A, B>(watched: A, others: B): boolean {
	const [seen, setSeen] = useState({ watched, others, alone: false });
	const watchedMoved = !Object.is(seen.watched, watched);
	const othersMoved = !Object.is(seen.others, others);
	if (!watchedMoved && !othersMoved) {
		return seen.alone;
	}
	const alone = watchedMoved && !othersMoved;
	setSeen({ watched, others, alone });
	return alone;
}
