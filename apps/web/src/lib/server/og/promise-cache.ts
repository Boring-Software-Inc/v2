export function promiseCache<T>(capacity: number) {
	const entries = new Map<string, Promise<T>>();
	return (key: string, make: () => Promise<T>): Promise<T> => {
		const hit = entries.get(key);
		if (hit) {
			entries.delete(key);
			entries.set(key, hit);
			return hit;
		}
		const made = make();
		entries.set(key, made);
		made.catch(() => {
			if (entries.get(key) === made) {
				entries.delete(key);
			}
		});
		for (const oldest of entries.keys()) {
			if (entries.size <= capacity) {
				break;
			}
			entries.delete(oldest);
		}
		return made;
	};
}
