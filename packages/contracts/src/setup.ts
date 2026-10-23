import { z } from "zod";

export const SETUP_STAGES = [
	"connect_mcp",
	"install_app",
	"sync_repos",
	"pick_rules",
	"turn_on_gate",
	"verify_check",
] as const;

export const setupStageSchema = z.enum(SETUP_STAGES);
export type SetupStage = z.infer<typeof setupStageSchema>;

export const setupStageStatusSchema = z.enum([
	"active",
	"waiting",
	"completed",
	"skipped",
	"failed",
]);
export type SetupStageStatus = z.infer<typeof setupStageStatusSchema>;

export const SETUP_RUN_CODE_LENGTH = 10;
export const setupRunCodeSchema = z
	.string()
	.regex(/^[A-Za-z0-9]{10}$/, "A run code is 10 letters or digits.");

export const SETUP_COMMAND_ARG_RE = /^([a-z0-9_-]+)#([A-Za-z0-9]{10})$/;

export function parseSetupCommandArg(
	arg: string,
): { org: string; code: string } | null {
	const match = SETUP_COMMAND_ARG_RE.exec(arg.trim());
	if (!(match?.[1] && match[2])) {
		return null;
	}
	return { org: match[1], code: match[2] };
}

export const setupStageStateSchema = z.object({
	status: setupStageStatusSchema,
	detail: z.string().max(256).nullable(),
	updatedAt: z.iso.datetime(),
});
export type SetupStageState = z.infer<typeof setupStageStateSchema>;

export const setupStagesSchema = z.partialRecord(
	setupStageSchema,
	setupStageStateSchema,
);
export type SetupStages = z.infer<typeof setupStagesSchema>;

export const setupProgressInputSchema = z.object({
	runCode: z.string().trim().min(1).max(200),
	stage: setupStageSchema,
	status: setupStageStatusSchema,
	detail: z.string().trim().max(256).optional(),
});
export type SetupProgressInput = z.infer<typeof setupProgressInputSchema>;

export const setupRunViewSchema = z.object({
	code: setupRunCodeSchema,
	stages: setupStagesSchema,
	completedAt: z.iso.datetime().nullable(),
	lastReportAt: z.iso.datetime().nullable(),
});
export type SetupRunView = z.infer<typeof setupRunViewSchema>;

export const SETUP_CLI_PACKAGE = "@tripwire-sh/cli";
export const TRIPWIRE_MCP_URL = "https://mcp.tripwire.sh/mcp";

export function setupInstallCommand(run?: { org: string; code: string }) {
	return run
		? `npx ${SETUP_CLI_PACKAGE} install ${run.org}#${run.code}`
		: `npx ${SETUP_CLI_PACKAGE} install`;
}

export function setupPrompt(
	run?: { org: string; code: string },
	mcpUrl: string = TRIPWIRE_MCP_URL,
): string {
	const head = run
		? `Please help me set up Tripwire.\n\norg slug: ${run.org}\nrun code: ${run.code}`
		: "Please help me set up Tripwire.";
	return `${head}\n\nIf you can run commands, run ${setupInstallCommand(run)}. If not, add the MCP server ${mcpUrl} and use its tools.`;
}
