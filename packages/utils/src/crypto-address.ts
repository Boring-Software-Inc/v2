import type { CryptoAddressKind } from "@tripwire/contracts";
import { validateWalletAddress } from "./wallet-address.ts";

export async function isCryptoAddress(
	kind: CryptoAddressKind,
	value: string,
): Promise<boolean> {
	return (
		validateWalletAddress(value, { chain: kind, network: "mainnet" }).status ===
		"valid"
	);
}

export function cryptoAddressCandidates(
	text: string,
): { kind: CryptoAddressKind; value: string; index: number }[] {
	const scanText = text.replace(
		/\bsha(1|256|384|512)-([A-Za-z0-9+/]+={0,2})/g,
		(digest: string, algorithm: string, encoded: string) => {
			const bytes = algorithm === "1" ? 20 : Number(algorithm) / 8;
			try {
				return atob(encoded).length === bytes
					? " ".repeat(digest.length)
					: digest;
			} catch {
				return digest;
			}
		},
	);
	const patterns: { kind: CryptoAddressKind; pattern: RegExp }[] = [
		{ kind: "eth", pattern: /(?<!\w)0x[0-9a-fA-F]{40}(?!\w)/g },
		{
			kind: "btc",
			pattern:
				/(?<!\w)(?:bc1[a-z0-9]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})(?!\w)/gi,
		},
		{ kind: "sol", pattern: /(?<!\w)[1-9A-HJ-NP-Za-km-z]{32,44}(?!\w)/g },
	];
	return patterns.flatMap(({ kind, pattern }) =>
		[...scanText.matchAll(pattern)]
			.filter((match) => {
				const before = scanText.slice(
					Math.max(0, match.index - 2048),
					match.index,
				);
				const after = scanText[match.index + match[0].length] ?? "";
				const inUrl = /https?:\/\/[^\s"'<>]*\/$/i.test(before);
				const assignment = /(?:^|[\s;{,])[A-Za-z_$][\w$]*\s*=$/.test(before);
				return (
					(inUrl || assignment || !/[+/=]$/.test(before)) &&
					!/^[+=]/.test(after) &&
					(inUrl || after !== "/")
				);
			})
			.map((match) => ({ kind, value: match[0], index: match.index })),
	);
}
