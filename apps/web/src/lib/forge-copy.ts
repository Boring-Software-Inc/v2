import { LIVE_FORGE_LABELS } from "@tripwire/contracts";

const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

export const LIVE_FORGES = LIST.format(LIVE_FORGE_LABELS);
