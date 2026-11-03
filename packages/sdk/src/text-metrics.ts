/**
 * Derived text metrics. One scan, two projections: the nonLatinRatio and
 * letterCount transforms both read this single implementation, so the ratio
 * and the letter count can never drift apart.
 *
 * Deterministic and dumb on purpose. A heuristic gate, not a language model.
 */
export function nonLatinScan(text: string) {
	let letters = 0;
	let nonLatin = 0;
	for (const ch of text) {
		if (!/\p{L}/u.test(ch)) {
			continue;
		}
		letters++;
		if (!/[\p{Script=Latin}]/u.test(ch)) {
			nonLatin++;
		}
	}
	return { ratio: letters === 0 ? 0 : nonLatin / letters, letters };
}
