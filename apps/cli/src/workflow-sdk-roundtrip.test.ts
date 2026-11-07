import { expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { z } from "zod";
import { buildProgram } from "#/program";
import { realSystem } from "#/system";
import { loadWorkflowFile } from "#/workflows-code";

const sdkPath = process.env.TRIPWIRE_TEST_SDK_PATH;
const sdkArchive = process.env.TRIPWIRE_TEST_SDK_ARCHIVE;
const cliArchive = process.env.TRIPWIRE_TEST_CLI_ARCHIVE;
const rpc = z.object({
	id: z.union([z.string(), z.number()]).optional(),
	method: z.string(),
	params: z
		.object({
			name: z.string().optional(),
			arguments: z
				.object({
					definitions: z.array(workflowDefinitionSchema).optional(),
				})
				.optional(),
		})
		.optional(),
});

test.skipIf(!sdkPath && !(sdkArchive && cliArchive))(
	"pull writes a project SDK file that compiles back to the same graph",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "tripwire-sdk-roundtrip-"));
		const cwd = process.cwd();
		const exitCode = process.exitCode;
		const definition: WorkflowDefinition = {
			id: "remote-workflow-id",
			name: "  Contributor review  ",
			version: 7,
			nodes: [
				{
					id: "opened",
					type: "trigger",
					kinds: ["change-request.opened"],
					position: { x: 20, y: -30 },
				},
				{
					id: "age",
					type: "rule",
					ref: "account-age@1",
					config: { minDays: 30 },
				},
				{
					id: "max-files",
					type: "rule",
					ref: "max-files-changed@1",
					config: { max: 50 },
				},
				{
					id: "unless",
					type: "gate",
					mode: "unless",
					position: { x: 100, y: 40 },
				},
				{ id: "review", type: "action", action: "send-to-moderation" },
				{ id: "denied", type: "action", action: "block" },
			],
			edges: [
				{ id: "edge-a", from: "opened", to: "age" },
				{ id: "edge-b", from: "unless", to: "review", when: "fail" },
				{
					id: "exception",
					from: "max-files",
					to: "unless",
					input: "exception",
				},
				{
					id: "requirement",
					from: "age",
					to: "unless",
					when: "pass",
					input: "requirement",
				},
				{ id: "check-files", from: "opened", to: "max-files" },
				{ id: "edge-c", from: "review", to: "denied", when: "deny" },
			],
		} satisfies WorkflowDefinition;
		const second = {
			...definition,
			id: "another-remote-id",
			name: "Second review",
			nodes: definition.nodes.slice(0, 1),
			edges: [],
		};
		const simple = {
			...definition,
			id: "simple-remote-id",
			name: "Simple gate",
			nodes: definition.nodes.filter((node) =>
				["opened", "age", "denied"].includes(node.id),
			),
			edges: [
				{ id: "pass-edge", from: "opened", to: "age", when: "pass" },
				{ id: "fail-edge", from: "age", to: "denied", when: "fail" },
			],
		} satisfies WorkflowDefinition;
		const scheduled: WorkflowDefinition = {
			id: "scheduled-lock",
			name: "Scheduled lock",
			version: 1,
			nodes: [
				{
					id: "trigger",
					type: "trigger",
					kinds: ["schedule.matched"],
					schedule: {
						every: { n: 12, unit: "hours" },
						match: {
							subjects: ["issue", "change-request"],
							state: "closed",
							inactiveFor: { n: 15, unit: "days" },
							skipLocked: true,
						},
					},
				},
				{
					id: "lock",
					type: "action",
					action: "lock",
					params: { reason: "resolved" },
				},
			],
			edges: [{ id: "e1", from: "trigger", to: "lock" }],
		};
		let remote: WorkflowDefinition = definition;
		let stopServer: (() => Promise<void>) | undefined;
		try {
			await writeFile(join(root, "package.json"), '{"type":"module"}');
			if (sdkArchive && cliArchive) {
				const installed = Bun.spawnSync(
					[
						process.execPath,
						"add",
						resolve(sdkArchive),
						resolve(cliArchive),
						"typescript@5.9.3",
					],
					{ cwd: root },
				);
				if (installed.exitCode !== 0)
					throw new Error(installed.stderr.toString());
			} else if (sdkPath) {
				const sdk = resolve(sdkPath);
				const scope = join(root, "node_modules", "@tripwire-sh");
				await mkdir(scope, { recursive: true });
				await symlink(sdk, join(scope, "sdk"), "junction");
				await symlink(
					join(sdk, "node_modules", "typescript"),
					join(root, "node_modules", "typescript"),
					"junction",
				);
			}
			process.chdir(root);
			const proposed: WorkflowDefinition[][] = [];
			const review = {
				id: "test-review",
				org: "acme",
				repo: "acme/widgets",
				url: "https://example.invalid/review",
				expiresAt: "2099-01-01T00:00:00Z",
				workflows: [
					{ id: definition.id, name: definition.name, change: "changed" },
				],
			};
			let reviewRead = false;
			const fetchMock: typeof fetch = Object.assign(
				async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
					if (typeof init?.body !== "string")
						throw new Error("Expected JSON-RPC body");
					const request = rpc.parse(JSON.parse(init.body));
					if (request.id === undefined)
						return new Response(null, { status: 202 });
					if (request.params?.name === "propose_workflow_push") {
						proposed.push(request.params.arguments?.definitions ?? []);
						return Response.json({
							jsonrpc: "2.0",
							id: request.id,
							result: {
								content: [],
								structuredContent: {
									result: "proposed",
									push: { ...review, status: "pending" },
								},
							},
						});
					}
					if (request.params?.name === "get_workflow_push") {
						reviewRead = true;
						return Response.json({
							jsonrpc: "2.0",
							id: request.id,
							result: {
								content: [],
								structuredContent: { ...review, status: "accepted" },
							},
						});
					}
					const result =
						request.method === "initialize"
							? {
									protocolVersion: "2025-03-26",
									capabilities: { tools: {} },
									serverInfo: { name: "test", version: "1" },
								}
							: {
									content: [],
									structuredContent: {
										workflows: [
											{ id: remote.id, definition: remote },
											{ id: second.id, definition: second },
											{ id: simple.id, definition: simple },
											{ id: scheduled.id, definition: scheduled },
										],
									},
								};
					return Response.json({ jsonrpc: "2.0", id: request.id, result });
				},
				{ preconnect: fetch.preconnect },
			);
			const program = () =>
				buildProgram(
					realSystem(
						{ TRIPWIRE_TOKEN: "test", TRIPWIRE_STAGING_TOKEN: "test" },
						process.platform,
					),
					{
						fetch: fetchMock,
					},
				).exitOverride();
			const server =
				cliArchive && sdkArchive
					? Bun.serve({
							hostname: "127.0.0.1",
							port: 0,
							async fetch(request) {
								if (request.method !== "POST")
									return new Response(null, { status: 405 });
								return fetchMock(request, { body: await request.text() });
							},
						})
					: undefined;
			if (server)
				stopServer = async () => {
					await server.stop(true);
				};
			async function run(args: string[]): Promise<number> {
				if (!server) {
					await program().parseAsync(args, { from: "user" });
					return Number(process.exitCode ?? 0);
				}
				const child = Bun.spawn(
					[
						process.execPath,
						join(
							root,
							"node_modules",
							"@tripwire-sh",
							"cli",
							"dist",
							"tripwire.js",
						),
						...args,
					],
					{
						cwd: root,
						env: {
							...process.env,
							TRIPWIRE_TOKEN: "test",
							TRIPWIRE_STAGING_TOKEN: "test",
							TRIPWIRE_MCP_URL: `http://127.0.0.1:${server.port}/mcp`,
						},
						stdout: "ignore",
						stderr: "pipe",
					},
				);
				const [code, stderr] = await Promise.all([
					child.exited,
					new Response(child.stderr).text(),
				]);
				if (code && !stderr)
					throw new Error(`Installed CLI exited ${code} without a diagnostic`);
				return code;
			}
			expect(
				await run([
					"workflows",
					"pull",
					"contributor-review",
					"--repo",
					"acme/widgets",
					"--json",
				]),
			).toBe(0);
			const directory = join(root, ".tripwire", "workflows");
			expect(await readdir(directory)).toEqual(["contributor-review.ts"]);
			expect(await run(["workflows", "pull", "--json"])).toBe(0);
			expect((await readdir(directory)).sort()).toEqual([
				"contributor-review.ts",
				"scheduled-lock.ts",
				"second-review.ts",
				"simple-gate.ts",
			]);
			const mapping = z
				.object({ workflows: z.record(z.string(), z.string()) })
				.parse(
					JSON.parse(
						await readFile(join(root, ".tripwire", "project.json"), "utf8"),
					),
				);
			expect(mapping.workflows["contributor-review"]).toBe(definition.id);
			expect(mapping.workflows["second-review"]).toBe(second.id);
			const draftPath = join(directory, "second-review.ts");
			const draftSource = await readFile(draftPath, "utf8");
			expect(draftSource).toContain("when: changeRequest.opened");
			expect(draftSource).not.toContain("defineWorkflow");
			const draft = await loadWorkflowFile(draftPath);
			expect(draft.ok).toBe(true);
			expect(draft.definitions[0]).toEqual({ ...second, id: "second-review" });
			const schedulePath = join(directory, "scheduled-lock.ts");
			const scheduleSource = await readFile(schedulePath, "utf8");
			expect(scheduleSource).toContain("when: schedule({");
			expect(scheduleSource).toContain(
				'run: lockConversation({ reason: "resolved" })',
			);
			expect(scheduleSource).not.toContain("workflowGraph");
			const compiledSchedule = await loadWorkflowFile(schedulePath);
			expect(compiledSchedule.ok).toBe(true);
			expect(compiledSchedule.definitions[0]).toEqual(scheduled);
			const simplePath = join(directory, "simple-gate.ts");
			const simpleSource = await readFile(simplePath, "utf8");
			expect(simpleSource).toContain(
				"require: accountAge({\n\t\tminDays: 30,\n\t})",
			);
			expect(simpleSource).toContain("otherwise: block()");
			const simpleCompiled = await loadWorkflowFile(simplePath);
			expect(simpleCompiled.ok).toBe(true);
			expect(simpleCompiled.definitions[0]).toEqual({
				...simple,
				id: "simple-gate",
			});
			expect(
				await run(["workflows", "validate", "contributor-review", "--json"]),
			).toBe(0);
			const compiled = await loadWorkflowFile(
				join(directory, "contributor-review.ts"),
			);
			expect(compiled.ok).toBe(true);
			expect(workflowDefinitionSchema.parse(compiled.definitions[0])).toEqual({
				...definition,
				id: "contributor-review",
			});
			const file = join(directory, "contributor-review.ts");
			const original = await readFile(file, "utf8");
			expect(original).toContain("workflowGraph({");
			expect(original).toContain('gate("unless")');
			expect(original).toContain("humanReview()");
			expect(original).not.toContain("defineWorkflow");
			const duplicateFile = join(directory, "duplicate-review.ts");
			await writeFile(duplicateFile, original);
			expect(
				await run([
					"workflows",
					"push",
					"contributor-review",
					"duplicate-review",
					"--no-browser",
				]),
			).toBe(1);
			expect(proposed).toEqual([]);
			process.exitCode = 0;
			await rm(duplicateFile);
			const authored = (
				"// Preserve this comment and newline style.\n" +
				original.replace("minDays: 30", "minDays: 45")
			).replaceAll("\n", "\r\n");
			await writeFile(file, authored);
			expect(
				await run([
					"workflows",
					"push",
					"contributor-review",
					"--json",
					"--wait",
					"--no-browser",
				]),
			).toBe(0);
			expect(reviewRead).toBe(true);
			expect(proposed).toEqual([
				[
					{
						...definition,
						authoredSource: authored,
						nodes: definition.nodes.map((node) =>
							node.id === "age" ? { ...node, config: { minDays: 45 } } : node,
						),
					},
				],
			]);
			const pull = ["workflows", "pull", "contributor-review", "--json"];
			const [submitted] = proposed[0] ?? [];
			if (!submitted) throw new Error("No workflow proposal was captured");
			remote = submitted;
			await rm(file);
			expect(await run(pull)).toBe(0);
			expect(await readFile(file, "utf8")).toBe(authored);
			remote = { ...definition, version: 8 };
			expect(await run(pull)).toBe(0);
			const updated = await readFile(file, "utf8");
			expect(updated).toContain("version: 8");

			const edited = `${updated}\n// Local edit\n`;
			await writeFile(file, edited);
			remote = { ...definition, version: 9 };
			expect(await run(pull)).toBe(1);
			expect(await readFile(file, "utf8")).toBe(edited);
		} finally {
			await stopServer?.();
			process.chdir(cwd);
			process.exitCode = exitCode ?? 0;
			await rm(root, { recursive: true, force: true });
		}
	},
	30_000,
);
