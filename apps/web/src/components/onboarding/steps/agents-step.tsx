import { SETUP_CLI_PACKAGE, TRIPWIRE_MCP_URL } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { CopyButton } from "@tripwire/ui/copy-button";
import { CodeText } from "@tripwire/ui/typography";
import { useState } from "react";
import { AgentClientLogo } from "#/components/agents/agent-client-logo";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import {
	type AgentKey,
	useOnboardingDraft,
} from "#/components/onboarding/onboarding-draft";
import { OnboardingStepHeader } from "#/components/onboarding/onboarding-frame";
import type { StepViewProps } from "#/components/onboarding/onboarding-steps";
import { AgentChatPreview } from "#/components/onboarding/preview/agent-chat-preview";

const copy = ONBOARDING_COPY.agents;

/** The command the CLI runs to add Tripwire to Claude Code. */
const CLAUDE_ADD = `claude mcp add --transport http tripwire ${TRIPWIRE_MCP_URL} --scope user`;
const CLI_INSTALL = `npx ${SETUP_CLI_PACKAGE} install`;

/** Cursor's MCP install link, carrying the server config it should write. */
function cursorInstallLink(): string {
	const config = btoa(JSON.stringify({ url: TRIPWIRE_MCP_URL }));
	return `cursor://anysphere.cursor-deeplink/mcp/install?name=tripwire&config=${encodeURIComponent(config)}`;
}

const CHATGPT_CONNECTORS = "https://chatgpt.com/#settings/Connectors";

/** The other agents the CLI installer sets up, as its registry names them. */
const MORE_AGENTS = [
	"GitHub Copilot CLI",
	"Gemini CLI",
	"Zed",
	"Amp",
	"Cline",
	"Codex",
	"Devin Desktop (Windsurf)",
	"Factory Droid",
	"Google Antigravity",
	"Goose",
	"Grok",
	"Kilo Code",
	"Kiro",
	"Muse Code",
	"OpenCode",
	"VS Code",
] as const;

/**
 * Step 9: connect a coding agent. Hovering or focusing a row shows that
 * agent's chat in the preview; finishing lands on the repo.
 */
export function AgentsStep({ flow }: StepViewProps) {
	const [, update] = useOnboardingDraft();
	const [showMore, setShowMore] = useState(false);
	const repo = flow.state.repo;
	const show = (agent: AgentKey) => () => update({ agent });

	return (
		<>
			<OnboardingStepHeader
				current={flow.step}
				steps={flow.steps}
				sub={copy.sub}
				title={copy.title}
			/>
			<div data-layout-role="onboarding-agents">
				<section
					aria-label="Claude Code"
					data-part="row"
					onFocus={show("claude")}
					onPointerEnter={show("claude")}
				>
					<AgentClientLogo clientName="Claude Code" />
					<span data-part="text">
						<span data-part="name">Claude Code</span>
						<CodeText>{CLAUDE_ADD}</CodeText>
					</span>
					<CopyButton size="small" value={CLAUDE_ADD} variant="ghost" />
				</section>
				<section
					aria-label="Cursor"
					data-part="row"
					onFocus={show("cursor")}
					onPointerEnter={show("cursor")}
				>
					<AgentClientLogo clientName="Cursor" />
					<span data-part="text">
						<span data-part="name">Cursor</span>
					</span>
					<Button href={cursorInstallLink()} size="small" variant="ghost">
						{copy.add}
					</Button>
				</section>
				<section
					aria-label="ChatGPT"
					data-part="row"
					onFocus={show("chatgpt")}
					onPointerEnter={show("chatgpt")}
				>
					<AgentClientLogo clientName="ChatGPT" />
					<span data-part="text">
						<span data-part="name">ChatGPT</span>
					</span>
					<Button
						href={CHATGPT_CONNECTORS}
						openInNewTab
						size="small"
						variant="ghost"
					>
						{copy.add}
					</Button>
				</section>
				<div data-part="row">
					<span data-part="text">
						<span data-part="more">{copy.more(MORE_AGENTS.length - 3)}</span>
						{showMore ? (
							<span data-part="list">{MORE_AGENTS.join(", ")}</span>
						) : null}
					</span>
					<Button
						onAction={() => setShowMore((open) => !open)}
						size="small"
						variant="ghost"
					>
						{copy.show}
					</Button>
				</div>
			</div>
			<section
				aria-label={copy.terminal}
				data-layout-role="onboarding-terminal"
			>
				<span data-layout-role="onboarding-field-legend">
					<span>{copy.terminal}</span>
				</span>
				<div data-part="command">
					<CodeText>{`$ ${CLI_INSTALL}`}</CodeText>
					<CopyButton size="small" value={CLI_INSTALL} variant="ghost" />
				</div>
			</section>
			<Button
				onAction={() => flow.finish("completed")}
				pending={flow.finishing}
				size="large"
				variant="primary"
			>
				{repo ? copy.goTo(repo.fullName) : copy.done}
			</Button>
			<p data-layout-role="onboarding-note" data-align="center">
				{copy.otherClients}
			</p>
		</>
	);
}

export function AgentsPreview({ flow }: StepViewProps) {
	const [draft] = useOnboardingDraft();
	return (
		<AgentChatPreview
			agent={draft.agent}
			repo={flow.state.repo?.fullName ?? flow.state.orgSlug ?? ""}
		/>
	);
}
