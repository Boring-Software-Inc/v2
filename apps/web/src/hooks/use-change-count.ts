import { useState } from "react";

export function useChangeCount<T>(value: T): number {
	const [current, setCurrent] = useState(value);
	const [count, setCount] = useState(0);
	if (!Object.is(value, current)) {
		setCurrent(value);
		setCount(count + 1);
	}
	return count;
}
