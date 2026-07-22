import { Tripwire } from "../client.ts";
import { defineForge } from "../forge.ts";
import {
	accountAge,
	filesChanged,
	isMaintainer,
	profileText,
	recentChangeRequestTimes,
} from "../registry.ts";

/**
 * Test-only consumer config, mirroring the documented pattern: bind the
 * forge once, export the destructured surface. The tests import from here
 * so the narrowing is proven to survive destructure plus re-import.
 */

export interface FakeClient {
	fetchJson(path: string): Promise<unknown>;
}

export const fullForge = defineForge<FakeClient>()({
	id: "fake-full",
	produces: {
		[accountAge.id]: () => 12,
		[profileText.id]: () => "hello",
		[isMaintainer.id]: () => false,
		[recentChangeRequestTimes.id]: () => [
			"2026-07-21T00:00:00.000Z",
			"2026-07-01T00:00:00.000Z",
		],
		[filesChanged.id]: () => 3,
	},
});

/** Deliberate gaps: profileText only. Everything else must be absent. */
export const gappedForge = defineForge<FakeClient>()({
	id: "fake-gapped",
	produces: {
		[profileText.id]: () => "hi",
	},
});

export const tripwire = new Tripwire({ forge: fullForge, apiKey: "tw_test" });
export const { rule, signals } = tripwire;

export const gapped = new Tripwire({ forge: gappedForge });
export const { rule: gappedRule, signals: gappedSignals } = gapped;
