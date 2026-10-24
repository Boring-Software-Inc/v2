import type { CSSProperties } from "react";

export const CODE_THEMES = { light: "pierre-light", dark: "pierre-dark" };

export const codeSurfaceStyle = {
	"--diffs-font-family": "var(--font-mono)",
	"--diffs-header-font-family": "var(--font-sans)",
	"--diffs-font-size": "12px",
	"--diffs-line-height": "20px",
	"--diffs-tab-size": "2",
	"--diffs-light-bg": "var(--code-surface)",
	"--diffs-dark-bg": "var(--code-surface)",
} as CSSProperties;
