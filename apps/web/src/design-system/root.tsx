import { OverlayHost } from "@tripwire/ui/overlays";
import colorContractCss from "@tripwire/ui/styles/color.css?url";
import componentContractCss from "@tripwire/ui/styles/components.css?url";
import semanticLayoutCss from "@tripwire/ui/styles/layout.css?url";
import tripwireCss from "@tripwire/ui/styles/tripwire.css?url";
import typographyCss from "@tripwire/ui/styles/typography.css?url";
import type { ReactNode } from "react";
import type { SkulletTheme } from "skullet";
import chartPlotCss from "#/components/common/chart-plot.css?url";
import { AgentBridgeProvider } from "#/design-system/agent-bridge-provider";
import { AgentConfirmationProvider } from "#/design-system/agent-confirmation";
import cardLayoutCss from "#/design-system/card-layouts.css?url";
import itemLayoutContractCss from "#/design-system/item-layout-contract.css?url";
import layoutContractCss from "#/design-system/layout-contract.css?url";

export const designSystemStyles = [
	tripwireCss,
	colorContractCss,
	componentContractCss,
	semanticLayoutCss,
	layoutContractCss,
	cardLayoutCss,
	chartPlotCss,
	itemLayoutContractCss,
	typographyCss,
];

export const designSystemBodyClass = "tripwire";

export const designSystemSkulletTheme: SkulletTheme = {
	light: {
		base: "rgb(5 5 5 / 0.06)",
		highlight: "rgb(255 255 255 / 0.86)",
	},
	dark: {
		base: "rgb(244 244 243 / 0.06)",
		highlight: "rgb(244 244 243 / 0.14)",
	},
	radius: "var(--radius-tag)",
	animation: "shimmer",
	speed: "slow",
};

export function DesignSystemRoot({ children }: { children: ReactNode }) {
	return (
		<AgentConfirmationProvider>
			<AgentBridgeProvider>
				{children}
				<OverlayHost />
			</AgentBridgeProvider>
		</AgentConfirmationProvider>
	);
}
