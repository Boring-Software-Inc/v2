/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
	operation: Promise<T>,
	ms: number,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("operation-timeout")), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
