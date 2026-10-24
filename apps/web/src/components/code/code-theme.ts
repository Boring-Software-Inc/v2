import { registerCustomCSSVariableTheme } from "@pierre/diffs";
import type { CSSProperties } from "react";

export const TRIPWIRE_CODE_THEME = "tripwire-glaze";

let registered = false;

export function registerTripwireCodeTheme(): void {
	if (registered) {
		return;
	}
	registered = true;
	registerCustomCSSVariableTheme(TRIPWIRE_CODE_THEME, {
		foreground: "var(--text-1)",
		background: "var(--code-surface)",
		"token-keyword": "var(--text-1)",
		"token-function": "var(--text-1)",
		"token-constant": "var(--text-1)",
		"token-parameter": "var(--text-1)",
		"token-string": "var(--text-1)",
		"token-string-expression": "var(--text-1)",
		"token-link": "var(--text-1)",
		"token-punctuation": "var(--text-2)",
		"token-comment": "var(--text-2)",
		"token-inserted": "var(--ok-text)",
		"token-deleted": "var(--fail-text)",
	});
}

export const codeSurfaceStyle = {
	"--diffs-font-family": "var(--font-mono)",
	"--diffs-header-font-family": "var(--font-sans)",
	"--diffs-font-size": "12px",
	"--diffs-line-height": "20px",
	"--diffs-tab-size": "2",
	"--diffs-light-bg": "var(--code-surface)",
	"--diffs-dark-bg": "var(--code-surface)",
	"--diffs-light": "var(--text-1)",
	"--diffs-dark": "var(--text-1)",
	"--diffs-fg-number-override": "var(--text-3)",
	"--diffs-addition-color": "var(--ok)",
	"--diffs-deletion-color": "var(--fail)",
	"--diffs-modified-color": "var(--text-2)",
	"--diffs-gap-inline": "var(--space-4)",
} as CSSProperties;
