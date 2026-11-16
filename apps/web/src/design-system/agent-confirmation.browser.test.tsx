import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface AgentConfirmationFixtureWindow extends Window {
	actionCount: number;
	agentTools: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(
			input: Record<string, never>,
		): Array<{ label?: string; ref: string }>;
		query(input: {
			text: string;
		}): Promise<Array<{ label?: string; ref: string }>>;
	};
	result?: Promise<{ ok: boolean }>;
}

test("registered browser agent tools respect Tripwire permission and approval gates", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-agent-button-"));
	const root = fileURLToPath(new URL("../../../../", import.meta.url));
	const entrypoint = join(directory, "client.tsx");
	try {
		await writeFile(
			entrypoint,
			`
			import { createElement } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { AgentBoundary } from ${JSON.stringify(join(root, "packages/ui/src/agent-policy.tsx"))};
			import { Button } from ${JSON.stringify(join(root, "packages/ui/src/button.tsx"))};
			import { Command } from ${JSON.stringify(join(root, "packages/ui/src/command.tsx"))};
			import { Combobox } from ${JSON.stringify(join(root, "packages/ui/src/combobox.tsx"))};
			import { OverlayHost } from ${JSON.stringify(join(root, "packages/ui/src/overlays.tsx"))};
			import { AgentBridgeProvider } from ${JSON.stringify(fileURLToPath(new URL("./agent-bridge-provider.tsx", import.meta.url)))};
			import { AgentConfirmationProvider } from ${JSON.stringify(fileURLToPath(new URL("./agent-confirmation.tsx", import.meta.url)))};

			window.actionCount = 0;
			const timezone = createElement(Combobox, {
				ariaLabel: "Timezone",
				defaultValue: "UTC",
				options: [
					{ label: "UTC", value: "UTC" },
					{ label: "London", value: "Europe/London" },
				],
			});
			const deleteWorkspace = createElement(Button, {
				confirmation: {
					confirmLabel: "Delete",
					description: "This cannot be undone.",
					title: "Delete workspace?",
				},
				onAction: () => { window.actionCount += 1; },
				variant: "destructive",
			}, "Delete workspace");
			const accountCommands = createElement(Command, {
				ariaLabel: "Account commands",
				items: [{
					confirmation: { title: "Sign out of Tripwire?" },
					label: "Sign out",
					onAction: () => { window.actionCount += 1; },
					tone: "destructive",
					value: "sign-out",
				}],
			});
			const restrictedAction = createElement(AgentBoundary, { visibility: "hidden" },
				createElement(Button, {
					onAction: () => { window.actionCount += 1; },
				}, "Restricted workspace action"),
			);
			createRoot(document.getElementById("root")).render(
				createElement(AgentConfirmationProvider, null,
					createElement(AgentBridgeProvider, null,
						deleteWorkspace,
						restrictedAction,
						accountCommands,
						timezone,
						createElement(OverlayHost),
					),
				),
			);
			`,
		);
		const build = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
			tsconfig: join(root, "apps/web/tsconfig.json"),
		});
		expect(build.success).toBe(true);
		const bundle = await build.outputs[0]?.text();
		if (!bundle) throw new Error("Agent button fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.addInitScript(() => {
				type AgentTools = AgentConfirmationFixtureWindow["agentTools"];
				const agentTools: Partial<AgentTools> = {};
				Object.assign(window, { agentTools });
				Object.defineProperty(document, "modelContext", {
					value: {
						registerTool: async <Name extends keyof AgentTools>(
							tool: { name: Name; execute: AgentTools[Name] },
							{ signal }: { signal: AbortSignal },
						) => {
							agentTools[tool.name] = tool.execute;
							signal.addEventListener(
								"abort",
								() => {
									delete agentTools[tool.name];
								},
								{ once: true },
							);
						},
					},
				});
			});
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://agent-button.test/client.js") {
					await route.fulfill({
						body: bundle,
						contentType: "text/javascript",
					});
					return;
				}
				if (url === "http://agent-button.test/") {
					await route.fulfill({
						body: '<div id="root"></div><script type="module" src="/client.js"></script>',
						contentType: "text/html",
					});
					return;
				}
				await route.abort();
			});
			const page = await context.newPage();
			page.setDefaultTimeout(2_000);
			await page.goto("http://agent-button.test/");
			const registeredTools = await page.waitForFunction(() => {
				const { agentTools } =
					window as unknown as AgentConfirmationFixtureWindow;
				const names = Object.keys(agentTools).sort();
				return names.length >= 3 && names;
			});
			expect(await registeredTools.jsonValue()).toEqual([
				"act",
				"query",
				"snapshot",
			]);
			const approval = page.getByRole("dialog", {
				name: "Allow agent action?",
			});
			const actionCount = () =>
				page.evaluate<number>(
					() =>
						(window as unknown as AgentConfirmationFixtureWindow).actionCount,
				);
			const query = (text: string) =>
				page.evaluate((search) => {
					const { agentTools } =
						window as unknown as AgentConfirmationFixtureWindow;
					return agentTools.query({ text: search });
				}, text);
			const act = (ref: string, action: string, args: unknown[] = []) =>
				page.evaluate(
					(step) => {
						const { agentTools } =
							window as unknown as AgentConfirmationFixtureWindow;
						return agentTools.act({ steps: [step] });
					},
					{ ref, action, args },
				);

			await page
				.getByRole("button", { name: "Restricted workspace action" })
				.waitFor();
			expect(await query("Restricted workspace action")).toEqual([]);
			expect((await act("Restricted workspace action", "press")).ok).toBe(
				false,
			);
			const targets = await query("Delete workspace");
			const button = targets.find(({ label }) => label === "Delete workspace");
			if (!button) throw new Error("Button was not exposed to the agent");
			const timezone = page.getByRole("combobox", { name: "Timezone" });
			await timezone.waitFor();
			expect(await timezone.inputValue()).toBe("UTC");
			expect((await act("Timezone", "setValue", ["Europe/London"])).ok).toBe(
				false,
			);
			expect(await timezone.inputValue()).toBe("UTC");
			expect((await act("Timezone", "setOpen", [true])).ok).toBe(true);
			await page.getByRole("option", { name: "London" }).waitFor();
			expect((await act("Timezone", "setOpen", [false])).ok).toBe(true);
			expect(await actionCount()).toBe(0);
			const startPress = (ref: string, args: string[] = []) =>
				page.evaluate(
					({ ref, args }) => {
						const fixtureWindow =
							window as unknown as AgentConfirmationFixtureWindow;
						fixtureWindow.result = fixtureWindow.agentTools.act({
							steps: [{ action: "press", args, ref }],
						});
					},
					{ ref, args },
				);
			const result = () =>
				page.evaluate(
					() => (window as unknown as AgentConfirmationFixtureWindow).result,
				);

			await startPress(button.ref);
			await approval.waitFor();
			expect(await approval.getByText("Delete workspace?").count()).toBe(1);
			expect(await actionCount()).toBe(0);
			const gateTargets = await page.evaluate(() => {
				const { agentTools } =
					window as unknown as AgentConfirmationFixtureWindow;
				return agentTools
					.snapshot({})
					.filter(
						({ label }) => label === "Allow agent action?" || label === "Allow",
					);
			});
			expect(gateTargets).toEqual([]);
			await approval.getByRole("button", { name: "Cancel" }).click();
			expect((await result())?.ok).toBe(false);
			expect(await actionCount()).toBe(0);

			await startPress(button.ref);
			await approval.waitFor();
			expect(await actionCount()).toBe(0);
			await approval.getByRole("button", { name: "Allow" }).click();
			expect((await result())?.ok).toBe(true);
			expect(await actionCount()).toBe(1);

			const [command] = await query("Account commands");
			if (!command) throw new Error("Command was not exposed to the agent");
			await startPress(command.ref, ["Sign out"]);
			await approval.waitFor();
			expect(await approval.getByText("Sign out of Tripwire?").count()).toBe(1);
			expect(await actionCount()).toBe(1);
			await approval.getByRole("button", { name: "Cancel" }).click();
			expect((await result())?.ok).toBe(false);
			expect(await actionCount()).toBe(1);

			await startPress(command.ref, ["Sign out"]);
			await approval.waitFor();
			expect(await actionCount()).toBe(1);
			await approval.getByRole("button", { name: "Allow" }).click();
			expect((await result())?.ok).toBe(true);
			expect(await actionCount()).toBe(2);
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
