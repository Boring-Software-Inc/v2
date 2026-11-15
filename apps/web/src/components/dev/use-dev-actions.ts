import { notify } from "@tripwire/ui/toast";
import { useState } from "react";
import { z } from "zod";
import { writeLatencyCookie } from "#/components/dev/use-dev-scenario";
import type { DevAppliedState } from "#/lib/dev/scenario-panel";
import type { DevScenario } from "#/lib/dev/scenarios";

const appliedSchema = z.object({ landing: z.string() });
const errorSchema = z.object({ error: z.string() });

export const DEV_CUSTOM_KEY = "custom";

async function post(
	path: string,
	body?: { scenario: DevScenario },
): Promise<Response> {
	return await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
}

export function useDevActions(onApplied: (applied: DevAppliedState) => void) {
	const [busy, setBusy] = useState<string | null>(null);

	async function apply(target: DevAppliedState): Promise<void> {
		setBusy(target.presetId ?? DEV_CUSTOM_KEY);
		const fallback = "Couldn't apply that scenario. Check the dev server log.";
		try {
			await writeLatencyCookie(target.latency);
			const res = await post("/api/dev/scenario", {
				scenario: target.scenario,
			});
			const body = await res.json().catch(() => null);
			const ok = appliedSchema.safeParse(body);
			if (!(res.ok && ok.success)) {
				const failed = errorSchema.safeParse(body);
				notify.show(
					{ title: failed.success ? failed.data.error : fallback },
					"error",
				);
				setBusy(null);
				return;
			}
			onApplied(target);
			window.location.assign(ok.data.landing);
		} catch (err) {
			notify.show(
				{ title: err instanceof Error ? err.message : fallback },
				"error",
			);
			setBusy(null);
		}
	}

	async function reset(): Promise<void> {
		setBusy("reset");
		try {
			await post("/api/dev/reset");
			window.location.assign("/");
		} catch {
			notify.show(
				{ title: "Couldn't reset dev data. Check the dev server log." },
				"error",
			);
			setBusy(null);
		}
	}

	async function logout(): Promise<void> {
		setBusy("logout");
		try {
			await post("/api/dev/logout");
			window.location.assign("/login");
		} catch {
			notify.show({ title: "Couldn't sign out. Try again." }, "error");
			setBusy(null);
		}
	}

	return { busy, apply, reset, logout };
}
