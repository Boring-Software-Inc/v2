import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export const TEST_TOKEN = "test-token-not-real";

export const TOOL_NAMES = [
	"whoami",
	"setup_status",
	"list_repos",
	"get_install_link",
	"list_rule_catalog",
	"get_repo_rules",
	"set_rule",
	"turn_on_gate",
	"list_workflows",
	"set_workflow_enabled",
	"get_workflow",
	"validate_workflow",
	"apply_workflow",
	"propose_workflow_push",
	"get_workflow_push",
	"list_runs",
	"get_run",
	"list_moderation_queue",
	"decide_moderation",
	"report_setup_progress",
] as const;

export interface ToolCall {
	name: string;
	args: z.infer<ReturnType<typeof z.json>>;
}

export interface FakeServer {
	url: string;
	authUrl: string;
	calls: ToolCall[];
	rejectNext(count: number): void;
	answerNext(name: string, data: z.infer<ReturnType<typeof z.json>>): void;
	stop(): Promise<void>;
}

const RESULTS: Record<string, z.infer<ReturnType<typeof z.json>>> = {
	whoami: {
		user: {
			id: "u1",
			name: "grim",
			email: "vysvisuals@gmail.com",
			accessStatus: "approved",
		},
		access: { approved: true },
		orgs: [{ slug: "grim", name: "grim", role: "admin", agentAllowed: true }],
		scopes: ["tripwire:read"],
	},
	setup_status: {
		org: "grim",
		role: "admin",
		hasInstallation: false,
		repos: [],
		nextStep: "install_app",
		guide: "Give installUrl to the user to open.",
		installUrl: "https://github.com/apps/tripwire/installations/new?state=s1",
		home: "https://app.tripwire.sh/grim/home",
	},
	list_repos: [
		{
			name: "scratch",
			fullName: "grim/scratch",
			forge: "github",
			gateOn: true,
			toReview: 2,
			blocked24h: 5,
			url: "https://app.tripwire.sh/grim/scratch",
		},
		{
			name: "website",
			fullName: "grim/website",
			forge: "github",
			gateOn: false,
			toReview: 0,
			blocked24h: 0,
			url: "https://app.tripwire.sh/grim/website",
		},
	],
	list_runs: [
		{
			id: "run_1",
			repo: "grim/scratch",
			number: 12,
			status: "completed",
			verdict: "block",
			createdAt: "2026-10-22T14:03:00.000Z",
			url: "https://app.tripwire.sh/runs/run_1",
		},
	],
	get_workflow: {
		code: "",
		warnings: [],
		workflows: [
			{
				id: "new-accounts",
				definition: {
					id: "new-accounts",
					name: "New accounts",
					version: 1,
					nodes: [
						{
							id: "trigger",
							type: "trigger",
							kinds: ["change-request.opened"],
						},
						{
							id: "account-age",
							type: "rule",
							ref: "account-age@1",
							config: { minDays: 7 },
						},
						{ id: "block", type: "action", action: "block" },
					],
					edges: [
						{ id: "e1", from: "trigger", to: "account-age" },
						{
							id: "e2",
							from: "account-age",
							to: "block",
							when: "fail",
						},
					],
				},
			},
		],
	},
	validate_workflow: {
		valid: true,
		workflows: [
			{
				id: "new-accounts",
				name: "New accounts",
				valid: true,
				issues: [],
				schedules: [],
				changes: [
					{
						change: "changed",
						subject: "step",
						id: "account-age",
						text: "account-age.minDays: 7 → 14",
					},
				],
			},
		],
	},
	apply_workflow: {
		workflows: [
			{
				id: "new-accounts",
				outcome: "updated",
				enabled: false,
				changes: [],
				url: "https://app.tripwire.sh/grim/scratch/workflows/w1",
			},
		],
	},
	propose_workflow_push: {
		result: "proposed",
		push: {
			id: "push-1",
			org: "grim",
			repo: "grim/scratch",
			status: "pending",
			url: "https://app.tripwire.sh/grim/scratch/workflows/review/push-1",
			expiresAt: "2026-10-24T13:00:00.000Z",
			workflows: [
				{ id: "new-accounts", name: "new-accounts", change: "changed" },
			],
		},
	},
	get_workflow_push: {
		id: "push-1",
		org: "grim",
		repo: "grim/scratch",
		status: "accepted",
		url: "https://app.tripwire.sh/grim/scratch/workflows/review/push-1",
		expiresAt: "2026-10-24T13:00:00.000Z",
		workflows: [
			{
				id: "new-accounts",
				name: "new-accounts",
				change: "changed",
				outcome: "updated",
				url: "https://app.tripwire.sh/grim/scratch/workflows/w1",
			},
		],
	},
	decide_moderation: {
		done: false,
		confirmUrl: "https://app.tripwire.sh/grim/scratch/moderation",
		forUser: "Open this link to review the contributor and decide yourself.",
	},
};

export function cannedResult(name: string) {
	return RESULTS[name] ?? null;
}

const NEXT = new Map<string, z.infer<ReturnType<typeof z.json>>[]>();

function reply(name: string, args: z.infer<ReturnType<typeof z.json>>) {
	const next = NEXT.get(name)?.shift();
	if (next !== undefined) {
		return {
			content: [{ type: "text" as const, text: JSON.stringify(next, null, 2) }],
		};
	}
	if (name === "get_run") {
		return {
			content: [
				{
					type: "text" as const,
					text: "No run r1 in grim. Call list_runs to see recent runs.",
				},
			],
			structuredContent: { error: "No run r1 in grim.", hint: "list_runs" },
			isError: true,
		};
	}
	const item = z.looseObject({ itemId: z.string() }).safeParse(args);
	if (
		name === "decide_moderation" &&
		item.success &&
		item.data.itemId === "item_closed"
	) {
		const error =
			"Review item item_closed closed with its change request #144 before anyone decided it. There is nothing to decide.";
		return {
			content: [{ type: "text" as const, text: error }],
			structuredContent: { error },
			isError: true,
		};
	}
	const repo = z.looseObject({ repo: z.string() }).safeParse(args);
	if (
		name === "list_workflows" &&
		repo.success &&
		repo.data.repo === "scratc"
	) {
		return {
			content: [
				{
					type: "text" as const,
					text: "The org grim has no repo named scratc. Call list_repos to see the repos.",
				},
			],
			structuredContent: {
				error: "The org grim has no repo named scratc.",
				hint: "list_repos",
				org: "grim",
			},
			isError: true,
		};
	}
	const data = RESULTS[name] ?? { tool: name, args };
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
	};
}

const STRICT: Partial<Record<string, z.ZodObject>> = {
	list_moderation_queue: z.object({
		org: z.string().optional(),
		repo: z.string(),
	}),
};

function buildServer(calls: ToolCall[]): McpServer {
	const server = new McpServer({ name: "fake-tripwire", version: "0.0.0" });
	for (const name of TOOL_NAMES) {
		server.registerTool(
			name,
			{ description: name, inputSchema: STRICT[name] ?? z.looseObject({}) },
			async (args) => {
				const parsed = z.json().parse(args);
				calls.push({ name, args: parsed });
				return reply(name, parsed);
			},
		);
	}
	return server;
}

export function startFakeServer(): FakeServer {
	const calls: ToolCall[] = [];
	let rejections = 0;
	const http = Bun.serve({
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			if (path.endsWith("/device/code")) {
				return Response.json({
					device_code: "device-1",
					user_code: "ABCD1234",
					verification_uri: "https://app.tripwire.sh/device",
					expires_in: 60,
					interval: 0,
				});
			}
			if (path.endsWith("/oauth2/token")) {
				return Response.json({ access_token: TEST_TOKEN, expires_in: 3600 });
			}
			if (request.headers.get("authorization") !== `Bearer ${TEST_TOKEN}`) {
				return new Response("unauthorized", { status: 401 });
			}
			if (rejections > 0) {
				rejections -= 1;
				return new Response("unauthorized", { status: 401 });
			}
			const transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
				enableJsonResponse: true,
			});
			const server = buildServer(calls);
			await server.connect(transport);
			return transport.handleRequest(request);
		},
	});
	return {
		url: `http://127.0.0.1:${http.port}/mcp`,
		authUrl: `http://127.0.0.1:${http.port}/api/auth`,
		calls,
		rejectNext: (count) => {
			rejections = count;
		},
		answerNext: (name, data) => {
			NEXT.set(name, [...(NEXT.get(name) ?? []), data]);
		},
		stop: async () => {
			await http.stop(true);
		},
	};
}
