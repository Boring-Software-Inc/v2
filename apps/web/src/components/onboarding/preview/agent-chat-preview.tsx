import { Check, Icon } from "@tripwire/ui/icon";
import { AgentClientLogo } from "#/components/agents/agent-client-logo";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import type { AgentKey } from "#/components/onboarding/onboarding-draft";

interface AgentChat {
	client: string;
	ask: string;
	status?: string;
	tool: string;
	lead?: string;
	items?: string[];
	reply: string;
	composer: string;
	note?: string;
}

/**
 * What asking each agent about Tripwire looks like, with the MCP tool it
 * calls. A sample conversation, like the sample run the Responses page shows,
 * pointed at the user's own repo.
 */
function chatFor(agent: AgentKey, repo: string): AgentChat {
	switch (agent) {
		case "cursor":
			return {
				client: "Cursor",
				ask: `What did Tripwire block in ${repo}?`,
				tool: "Called list_runs",
				lead: `Tripwire blocked 3 change requests in ${repo}:`,
				items: [
					`${repo} #412 Update README badges by ghostdev1, account is 2 days old`,
					`${repo} #430 Add airdrop link by coinminer88, adds a crypto address`,
					`${repo} #427 Bump dependency by newuser42, account is 1 day old`,
				],
				reply: "Want me to open one?",
				composer: "Add a follow-up",
			};
		case "chatgpt":
			return {
				client: "ChatGPT",
				ask: `Raise the account age minimum on ${repo} to 14 days`,
				tool: `Updated Account age on ${repo}`,
				reply: `Done. Account age is now 14 days on ${repo}. New change requests from accounts under 14 days will be blocked.`,
				composer: "Ask ChatGPT",
				note: "ChatGPT can make mistakes. Check important info.",
			};
		default:
			return {
				client: "Claude Code",
				ask: `Why was ${repo} #412 blocked?`,
				status: "Looking up why Tripwire blocked a change request.",
				tool: "Called get_run",
				reply:
					"Account age did not pass. ghostdev1's account is 2 days old. It will clear on its own once the account is 7 days old.",
				composer: "Reply",
				note: "Claude is AI and can make mistakes.",
			};
	}
}

export function AgentChatPreview({
	agent,
	repo,
}: {
	agent: AgentKey;
	repo: string;
}) {
	const chat = chatFor(agent, repo);
	return (
		<div aria-hidden="true" data-layout-role="onboarding-agent-chat" inert>
			<div data-part="card" data-agent={agent}>
				<div data-part="client">
					<AgentClientLogo clientName={chat.client} />
					<span>{chat.client}</span>
				</div>
				<p data-part="ask">{chat.ask}</p>
				{chat.status ? <p data-part="thinking">{chat.status}</p> : null}
				<p data-part="tool">
					{agent === "chatgpt" ? (
						<Icon icon={Check} size={14} />
					) : (
						<TripwireWordmark height={10} width={16} />
					)}
					{chat.tool}
				</p>
				{chat.lead ? <p data-part="reply">{chat.lead}</p> : null}
				{chat.items ? (
					<ol data-part="items">
						{chat.items.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ol>
				) : null}
				<p data-part="reply">{chat.reply}</p>
				<div data-part="composer">{chat.composer}</div>
				{chat.note ? <p data-part="note">{chat.note}</p> : null}
			</div>
		</div>
	);
}
