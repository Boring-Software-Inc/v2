import { z } from "zod";

export const walletChainSchema = z.enum([
	"bitcoin",
	"evm",
	"solana",
	"tron",
	"xrp",
	"cardano",
	"litecoin",
	"dogecoin",
	"bitcoin-cash",
	"cosmos",
	"ton",
	"sui",
	"stellar",
	"monero",
	"polkadot",
	"tezos",
]);
export type WalletChain = z.infer<typeof walletChainSchema>;
export const walletNetworkSchema = z.enum([
	"mainnet",
	"testnet",
	"devnet",
	"regtest",
	"stagenet",
]);
export type WalletNetwork = z.infer<typeof walletNetworkSchema>;
export const walletAddressRequestSchema = z
	.object({
		address: z
			.string()
			.min(1)
			.max(512)
			.regex(/^[\x21-\x7e]+$/),
		chain: z
			.string()
			.min(1)
			.max(40)
			.regex(/^[a-zA-Z0-9 -]+$/),
		network: walletNetworkSchema.default("mainnet"),
	})
	.strict();
export type WalletAddressRequest = z.infer<typeof walletAddressRequestSchema>;
export const walletAddressValidationSchema = z.discriminatedUnion("status", [
	z
		.object({
			status: z.literal("valid"),
			chain: walletChainSchema,
			network: walletNetworkSchema,
			canonicalAddress: z.string(),
			format: z.string(),
			compatibleNetworks: z.array(walletNetworkSchema).min(1),
			networkDiscrimination: z.enum(["encoded", "shared"]),
			chainId: z.number().int().positive().optional(),
		})
		.refine(
			(value) =>
				value.compatibleNetworks.includes(value.network) &&
				(value.chain === "evm"
					? value.chainId !== undefined
					: value.chainId === undefined) &&
				(value.networkDiscrimination === "encoded"
					? value.compatibleNetworks.length === 1
					: value.compatibleNetworks.length > 1),
			"Address network metadata is inconsistent.",
		),
	z.object({
		status: z.literal("invalid"),
		reason: z.enum(["invalid-input", "invalid-address", "network-mismatch"]),
	}),
	z.object({
		status: z.literal("unsupported"),
		reason: z.enum(["chain", "network"]),
	}),
]);
export type WalletAddressValidation = z.infer<
	typeof walletAddressValidationSchema
>;
export type ValidWalletAddress = Extract<
	WalletAddressValidation,
	{ status: "valid" }
>;
export const walletAddressObservationSchema = z
	.object({
		status: z.enum(["observed", "not-observed", "unavailable", "unsupported"]),
		chain: walletChainSchema,
		network: walletNetworkSchema,
		address: z.string().min(1).max(512),
		checkedAt: z.iso.datetime(),
		chainId: z.number().int().positive().optional(),
		balance: z
			.string()
			.max(100)
			.regex(/^(?:0|[1-9][0-9]*)$/)
			.optional(),
		transactionCount: z.number().int().nonnegative().optional(),
		historyLimit: z.number().int().positive().optional(),
		nonce: z
			.string()
			.max(100)
			.regex(/^(?:0|[1-9][0-9]*)$/)
			.optional(),
		codePresent: z.boolean().optional(),
		accountOwner: z.string().optional(),
		executable: z.boolean().optional(),
		reason: z.string().optional(),
	})
	.refine(
		(value) =>
			value.chain === "evm"
				? value.chainId !== undefined
				: value.chainId === undefined,
		"EVM observations require their selected chain ID.",
	)
	.refine(
		(value) =>
			value.status !== "not-observed" ||
			!(
				/^[1-9][0-9]*$/.test(value.balance ?? "") ||
				/^[1-9][0-9]*$/.test(value.nonce ?? "") ||
				(value.transactionCount ?? 0) > 0 ||
				value.codePresent === true ||
				value.accountOwner !== undefined ||
				value.executable !== undefined
			),
		"A negative observation cannot contain positive activity evidence.",
	);
export type WalletAddressObservation = z.infer<
	typeof walletAddressObservationSchema
>;
export const walletAddressInspectionSchema = z.object({
	validation: walletAddressValidationSchema,
	activity: walletAddressObservationSchema.optional(),
});
export type WalletAddressInspection = z.infer<
	typeof walletAddressInspectionSchema
>;
