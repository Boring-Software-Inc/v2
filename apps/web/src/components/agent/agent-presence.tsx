import type { AgentPresence as Presence } from "@tripwire/contracts";
import { AgentRain } from "#/components/agent/agent-rain";
import type { AgentMotion } from "#/hooks/use-agent-motion";
import { cn } from "#/lib/glaze/utils";

export function presenceWords(agents: readonly Presence[]): string | null {
	const names = [...new Set(agents.map((agent) => agent.name))];
	if (names.length === 0) {
		return null;
	}
	if (names.length === 1) {
		return `${names[0]} is building this`;
	}
	const last = names[names.length - 1];
	return `${names.slice(0, -1).join(", ")} and ${last} are building this`;
}

/** Who is working on this right now, in plain words, with the activity mark. */
export function AgentPresence({
	agents,
	motion,
	className,
}: {
	agents: readonly Presence[];
	motion: AgentMotion;
	className?: string;
}) {
	const words = presenceWords(agents);
	if (!words) {
		return null;
	}
	return (
		<output
			className={cn(
				"inline-flex min-w-0 items-center gap-2 type-body-sm text-text-2",
				className,
			)}
		>
			<AgentRain motion={motion} seed={agents[0]?.clientId} />
			<span className="truncate">{words}</span>
		</output>
	);
}
