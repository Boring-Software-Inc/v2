import { useState } from "react";

export function usePreviousValue<T>(value: T): T {
	const [current, setCurrent] = useState(value);
	const [previous, setPrevious] = useState(value);
	if (!Object.is(value, current)) {
		setPrevious(current);
		setCurrent(value);
	}
	return previous;
}
