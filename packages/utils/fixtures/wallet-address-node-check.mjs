import { readFileSync } from "node:fs";
import { validateWalletAddress } from "../src/wallet-address.ts";

const vectors = JSON.parse(
	readFileSync(
		new URL("./wallet-address-vectors.json", import.meta.url),
		"utf8",
	),
);
process.stdout.write(
	JSON.stringify(
		vectors.map((vector) =>
			validateWalletAddress(vector.address, {
				chain: vector.chain,
				network: vector.network,
			}),
		),
	),
);
