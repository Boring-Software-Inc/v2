import { z } from "zod";

export const cryptoAddressKindSchema = z.enum(["eth", "btc", "sol"]);
export type CryptoAddressKind = z.infer<typeof cryptoAddressKindSchema>;

export const cryptoAddressActivitySchema = z
	.object({
		kind: cryptoAddressKindSchema,
		value: z.string(),
		network: z.enum(["ethereum-mainnet", "bitcoin-mainnet", "solana-mainnet"]),
		checkedAt: z.iso.datetime(),
		status: z.enum(["observed", "not-observed", "unavailable"]),
		balance: z.string().optional(),
		transactionCount: z.number().int().nonnegative().optional(),
		historyLimit: z.number().int().positive().optional(),
		nonce: z.string().optional(),
		codePresent: z.boolean().optional(),
		accountOwner: z.string().optional(),
		executable: z.boolean().optional(),
		reason: z.string().optional(),
	})
	.refine(
		(activity) =>
			activity.network ===
			(activity.kind === "eth"
				? "ethereum-mainnet"
				: activity.kind === "btc"
					? "bitcoin-mainnet"
					: "solana-mainnet"),
		"Address kind and observed network must agree.",
	);
export type CryptoAddressActivity = z.infer<typeof cryptoAddressActivitySchema>;

/** Locations refer to added lines. Checks retain inconclusive activity separately from confirmed matches. */
export const cryptoAddressEvidenceSchema = z.object({
	matches: z.array(
		z.object({
			kind: cryptoAddressKindSchema,
			value: z.string(),
			location: z.string(),
			line: z.number().int().positive().optional(),
			confirmation: z.enum([
				"checksum",
				"address-format",
				"payment-context",
				"chain-activity",
			]),
		}),
	),
	checks: z.array(cryptoAddressActivitySchema),
});
export type CryptoAddressEvidence = z.infer<typeof cryptoAddressEvidenceSchema>;

export const cryptoRpcResponseSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.literal(1),
	result: z.unknown(),
	error: z.unknown().optional(),
});
export type CryptoRpcResponse = z.infer<typeof cryptoRpcResponseSchema>;
export const cryptoHexQuantitySchema = z
	.string()
	.regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/);
export type CryptoHexQuantity = z.infer<typeof cryptoHexQuantitySchema>;
export const cryptoHexCodeSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
export type CryptoHexCode = z.infer<typeof cryptoHexCodeSchema>;
export const bitcoinAddressActivityResponseSchema = z.object({
	chain_stats: z.object({ tx_count: z.number().int().nonnegative() }),
	mempool_stats: z.object({ tx_count: z.number().int().nonnegative() }),
});
export type BitcoinAddressActivityResponse = z.infer<
	typeof bitcoinAddressActivityResponseSchema
>;
export const solanaLamportsSchema = z.union([
	z.number().int().nonnegative(),
	z
		.string()
		.regex(/^(?:0|[1-9][0-9]{0,19})$/)
		.refine(
			(value) =>
				/^(?:0|[1-9][0-9]{0,19})$/.test(value) &&
				BigInt(value) <= 18446744073709551615n,
		),
]);
export type SolanaLamports = z.infer<typeof solanaLamportsSchema>;
export const solanaAccountActivityResponseSchema = z.object({
	value: z
		.object({
			lamports: solanaLamportsSchema,
			owner: z.string(),
			executable: z.boolean(),
		})
		.nullable(),
});
export type SolanaAccountActivityResponse = z.infer<
	typeof solanaAccountActivityResponseSchema
>;
export const solanaAddressSignaturesResponseSchema = z.array(
	z.object({ signature: z.string(), slot: z.number().int().nonnegative() }),
);
export type SolanaAddressSignaturesResponse = z.infer<
	typeof solanaAddressSignaturesResponseSchema
>;
