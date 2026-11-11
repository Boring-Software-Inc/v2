import colorContractCss from "@tripwire/ui/styles/color.css?url";
import semanticLayoutCss from "@tripwire/ui/styles/layout.css?url";
import typographyCss from "@tripwire/ui/styles/typography.css?url";
import type { ReactNode } from "react";
import type { SkulletTheme } from "skullet";
import { DestructiveConfirmationProvider } from "#/components/common/destructive-confirmation-provider";
import glazeCss from "#/components/glaze/styles.css?url";
import layoutContractCss from "#/design-system/layout-contract.css?url";
import { GlazePortalProvider } from "#/lib/glaze/portal";

export const designSystemStyles = [
	glazeCss,
	colorContractCss,
	semanticLayoutCss,
	layoutContractCss,
	typographyCss,
];

export const designSystemBodyClass = "glaze";

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
		<GlazePortalProvider>
			<DestructiveConfirmationProvider>
				{children}
			</DestructiveConfirmationProvider>
		</GlazePortalProvider>
	);
}
