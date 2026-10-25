import {
	FORGE_BY_ID,
	LIVE_FORGE_LABELS,
	SIGN_IN_FORGE_IDS,
} from "@tripwire/contracts";

const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

export const LIVE_FORGES = LIST.format(LIVE_FORGE_LABELS);

export const SIGN_IN_FORGES = LIST.format(
	SIGN_IN_FORGE_IDS.map((id) => FORGE_BY_ID[id].label),
);
