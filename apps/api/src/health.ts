import type { GitCafeOperationalSummary } from "@tripwire/contracts";
import { gitCafeOperationalServices, requirePostgresPool } from "@tripwire/db";
import { withTimeout } from "@tripwire/utils";
import type { ApiDeps } from "./env.ts";

export function createApiHealth(deps: ApiDeps, now: () => number = Date.now) {
	let sampledAt = Number.NEGATIVE_INFINITY;
	let summary: GitCafeOperationalSummary | null = null;
	let dependenciesReady = false;
	let sampling: Promise<void> | null = null;
	const consecutive = new Map<string, number>();
	const alerts = new Set<string>();
	const signal = (
		stage: string,
		age: number | null,
		threshold: number,
		samples = 2,
	) => {
		const failing = age !== null && age > threshold;
		const count = failing ? (consecutive.get(stage) ?? 0) + 1 : 0;
		consecutive.set(stage, count);
		if (count >= samples && !alerts.has(stage)) {
			alerts.add(stage);
			deps.logger.error(
				{
					event: "gitcafe.backlog.alert",
					service: "api",
					environment: process.env.UNKEY_ENVIRONMENT_SLUG ?? "unknown",
					stage,
					ageSeconds: age,
				},
				"GitCafe protection stalled",
			);
		} else if (!failing && alerts.delete(stage)) {
			deps.logger.info(
				{ event: "gitcafe.backlog.recovered", service: "api", stage },
				"GitCafe protection recovered",
			);
		}
	};
	const read = async (requireProtection: boolean) => {
		if (now() - sampledAt >= 30_000 && !sampling) {
			sampling = (async () => {
				try {
					if (deps.gitCafeReceipts)
						summary = await withTimeout(
							gitCafeOperationalServices.readGitCafeOperationalSummary(deps.db),
							4_000,
						);
					else {
						const query = {
							text: "SELECT 1 FROM pgboss.queue LIMIT 1",
							query_timeout: 3_000,
						};
						await withTimeout(requirePostgresPool(deps.db).query(query), 4_000);
					}
					dependenciesReady = true;
					if (summary) {
						signal("receipt", summary.oldestReceiptAgeSeconds, 120);
						signal("event", summary.oldestEventAgeSeconds, 120);
						signal("action", summary.oldestActionAgeSeconds, 300);
						signal("heartbeat", summary.heartbeatAgeSeconds ?? 91, 90, 1);
					}
					signal("dependencies", 0, 0, 1);
				} catch {
					dependenciesReady = false;
					signal("dependencies", 1, 0, 1);
				} finally {
					sampledAt = now();
				}
			})().finally(() => {
				sampling = null;
			});
		}
		await sampling;
		const freshHeartbeat =
			summary?.heartbeatAgeSeconds != null &&
			summary.heartbeatAgeSeconds + (now() - sampledAt) / 1000 <= 90;
		const ready =
			dependenciesReady &&
			(!deps.gitCafeReceipts || (freshHeartbeat && alerts.size === 0));
		const ok = dependenciesReady && (!requireProtection || ready);
		return {
			body: {
				ok,
				live: true,
				ready,
				gitcafe: deps.gitCafeReceipts
					? ready
						? "ready"
						: "degraded"
					: "disabled",
				reason: !dependenciesReady
					? "dependencies-unavailable"
					: deps.gitCafeReceipts && !freshHeartbeat
						? "protection-heartbeat-missing"
						: alerts.size
							? "backlog-stalled"
							: "ready",
			},
			status: ok ? (200 as const) : (503 as const),
		};
	};
	return {
		readHealth: () => read(false),
		readReadiness: () => read(true),
	};
}
