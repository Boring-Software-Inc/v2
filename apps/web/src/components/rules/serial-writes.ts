export type SerialWrite = <T>(
	key: string,
	task: () => Promise<T>,
	onIdle: () => Promise<void>,
) => Promise<T>;

export function createSerialWrites(): SerialWrite {
	const tails = new Map<string, Promise<void>>();
	const queued = new Map<string, number>();
	return (key, task, onIdle) => {
		queued.set(key, (queued.get(key) ?? 0) + 1);
		const result = (tails.get(key) ?? Promise.resolve()).then(task);
		const tail = result
			.then(
				() => undefined,
				() => undefined,
			)
			.then(async () => {
				const left = (queued.get(key) ?? 1) - 1;
				if (left > 0) {
					queued.set(key, left);
					return;
				}
				queued.delete(key);
				await onIdle();
			});
		tails.set(key, tail);
		return result;
	};
}
