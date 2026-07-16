import type { WorkflowNode } from "@tripwire/contracts";

/**
 * ONE color profile per node kind, shared by the toolbox, the canvas node
 * cards, and anything else that names a kind — the same visual grammar as the
 * activity feed's verdict chips (`bg-<hue>-500/10 text-<hue>-600
 * dark:text-<hue>-400` tints, solid `bg-<hue>-500` dots), so the editor
 * speaks the app's existing color language instead of inventing a new one.
 *
 *   trigger → sky    (signals coming in)
 *   rule    → violet (checks)
 *   gate    → amber  (decision points)
 *   action  → rose   (acts on the change request)
 */
export interface KindStyle {
	/** Tinted chip — kind label on node cards. */
	chip: string;
	/** Solid dot — section headers + toolbox rows. */
	dot: string;
	/** Left accent border for cards/rows. */
	accent: string;
	/** Hover-only left accent (toolbox rows). */
	hoverAccent: string;
	/** Strong text in the kind's hue. */
	text: string;
}

export const KIND_STYLES: Record<WorkflowNode["type"], KindStyle> = {
	trigger: {
		chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
		dot: "bg-sky-500",
		accent: "border-l-sky-500/50",
		hoverAccent: "hover:border-l-sky-500/60",
		text: "text-sky-600 dark:text-sky-400",
	},
	rule: {
		chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
		dot: "bg-violet-500",
		accent: "border-l-violet-500/50",
		hoverAccent: "hover:border-l-violet-500/60",
		text: "text-violet-600 dark:text-violet-400",
	},
	gate: {
		chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
		dot: "bg-amber-500",
		accent: "border-l-amber-500/50",
		hoverAccent: "hover:border-l-amber-500/60",
		text: "text-amber-600 dark:text-amber-400",
	},
	action: {
		chip: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
		dot: "bg-rose-500",
		accent: "border-l-rose-500/50",
		hoverAccent: "hover:border-l-rose-500/60",
		text: "text-rose-600 dark:text-rose-400",
	},
};
