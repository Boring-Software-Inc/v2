import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface CommandFixtureWindow extends Window {
	actionSources: string[];
	agent: {
		act(input: {
			steps: Array<{ action: string; args: string[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{ component: string; label?: string; ref: string }>;
	};
	allowDestructive: boolean;
	controlledQueries: Array<{ query: string; source: string }>;
	destructiveCount: number;
	navigations: string[];
	resolveAction: () => void;
}

test("commands own search, actions, links, pending, dialog, and agent behavior", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-command-"));
	const root = fileURLToPath(new URL("../../../", import.meta.url));
	const entrypoint = join(directory, "client.tsx");
	try {
		await writeFile(
			entrypoint,
			`
			import ${JSON.stringify(join(root, "packages/ui/src/styles/theme.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/base.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/color.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/presentational.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/components.css"))};
			import { createAgent } from ${JSON.stringify(join(root, "node_modules/@ui-sdk/react/dist/agent.js"))};
			import { createElement, Fragment, useState } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { Command, CommandDialog } from ${JSON.stringify(fileURLToPath(new URL("./command.tsx", import.meta.url)))};
			import { OverlayHost } from ${JSON.stringify(fileURLToPath(new URL("./overlays.tsx", import.meta.url)))};

			window.actionSources = [];
			window.allowDestructive = false;
			window.controlledQueries = [];
			window.destructiveCount = 0;
			window.navigations = [];
			window.resolveAction = () => undefined;
			window.agent = createAgent({ allow: (action) => action.confirm ? window.allowDestructive : true });

			const icon = createElement("svg", { "aria-hidden": "true", viewBox: "0 0 16 16" }, createElement("path", { d: "M2 8h12" }));
			const commandItems = [
				{
					items: [
						{
							icon,
							label: "Sync now",
							onAction: (details) => {
								window.actionSources.push(details.source);
								return new Promise((resolve) => { window.resolveAction = resolve; });
							},
							statusBadges: [{ label: "2 pending", tone: "warning" }],
							value: "sync",
						},
						{
							current: true,
							href: "#settings",
							label: "Open settings",
							labelBadge: { label: "Personal", variant: "outline" },
							onNavigate: (href, details) => window.navigations.push(href + ":" + details.source),
							type: "link",
							value: "settings",
						},
						{
							disabled: true,
							label: "Unavailable action",
							onAction: () => window.actionSources.push("disabled"),
							value: "unavailable",
						},
						{
							label: "Run report",
							onAction: (details) => window.actionSources.push("report:" + details.source),
							value: "report",
						},
					],
					label: "Actions",
					type: "group",
				},
				{ id: "account-separator", type: "separator" },
				{
					confirmation: {
						confirmLabel: "Sign out",
						description: "Your session on this device ends.",
						title: "Sign out of Tripwire?",
					},
					label: "Sign out",
					onAction: () => { window.destructiveCount += 1; },
					tone: "destructive",
					value: "sign-out",
				},
			];

			function Fixture() {
				const [loading, setLoading] = useState(false);
				return createElement(Fragment, null,
					createElement("main", { className: "tripwire", "data-theme": "light" },
						createElement("section", { "aria-label": "Primary command" },
							createElement(Command, {
								ariaLabel: "Search Tripwire",
								defaultQuery: "sync",
								emptyLabel: "No matching destination",
								footerHints: [{ key: "Enter", label: "Open" }, { key: "Esc", label: "Close" }],
								items: commandItems,
								loading,
								loadingContent: "Loading destinations",
								placeholder: "Search destinations",
							}),
						),
						createElement("button", { onClick: () => setLoading((value) => !value), type: "button" }, "Toggle loading"),
						createElement("section", { "aria-label": "Controlled command" },
							createElement(Command, {
								ariaLabel: "Controlled search",
								items: commandItems,
								onQueryChange: (query, details) => window.controlledQueries.push({ query, source: details.source }),
								query: "fixed",
							}),
						),
						createElement(CommandDialog, {
							ariaLabel: "Dialog search",
							items: [{ label: "Open profile", onAction: (details) => window.actionSources.push("dialog:" + details.source), value: "profile" }],
							placeholder: "Search pages",
							title: "Command palette",
							trigger: createElement("button", { type: "button" }, "Open palette"),
						}),
					),
					createElement(OverlayHost),
				);
			}

			createRoot(document.getElementById("root")).render(createElement(Fixture));
			`,
		);
		const build = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
		});
		expect(build.success).toBe(true);
		const scriptOutput = build.outputs.find((output) =>
			output.path.endsWith(".js"),
		);
		const styleOutput = build.outputs.find((output) =>
			output.path.endsWith(".css"),
		);
		const bundle = await scriptOutput?.text();
		const styles = await styleOutput?.text();
		if (!(bundle && styles))
			throw new Error("Command browser fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://command.test/client.js") {
					await route.fulfill({ body: bundle, contentType: "text/javascript" });
					return;
				}
				if (url === "http://command.test/client.css") {
					await route.fulfill({ body: styles, contentType: "text/css" });
					return;
				}
				if (url === "http://command.test/") {
					await route.fulfill({
						body: '<body class="tripwire" data-system="tripwire"><link rel="stylesheet" href="/client.css"><div id="root"></div><script type="module" src="/client.js"></script></body>',
						contentType: "text/html",
					});
					return;
				}
				await route.abort();
			});
			const page = await context.newPage();
			page.setDefaultTimeout(2_000);
			await page.goto("http://command.test/");
			const primary = page.getByRole("region", { name: "Primary command" });
			const input = primary.getByRole("combobox", { name: "Search Tripwire" });
			const list = primary.getByRole("listbox");
			const fixture = () =>
				page.evaluate(() => {
					const value = window as unknown as CommandFixtureWindow;
					return {
						actionSources: value.actionSources,
						controlledQueries: value.controlledQueries,
						destructiveCount: value.destructiveCount,
						navigations: value.navigations,
					};
				});

			expect(await input.inputValue()).toBe("sync");
			expect(await input.getAttribute("aria-controls")).toBe(
				await list.getAttribute("id"),
			);
			expect(await primary.getByRole("option").count()).toBe(1);
			await input.fill("missing");
			const empty = primary.getByText("No matching destination");
			expect(await empty.isVisible()).toBe(true);
			expect(
				await empty.evaluate(
					(element) => element.closest('[role="listbox"]') === null,
				),
			).toBe(true);
			await input.fill("");
			expect(await primary.getByRole("option").count()).toBe(5);
			const settings = primary.getByRole("option", { name: /Open settings/ });
			expect(await settings.evaluate((element) => element.tagName)).toBe("A");
			expect(await settings.getAttribute("href")).toBe("#settings");
			expect(await settings.getAttribute("aria-current")).toBe("page");
			expect(
				await primary.locator('[data-slot="command-item-icon"] svg').count(),
			).toBe(1);
			expect(
				await primary
					.locator('[data-slot="command-item-label-badge"]')
					.innerText(),
			).toBe("Personal");
			expect(
				await primary
					.locator('[data-slot="command-item-status"]')
					.first()
					.innerText(),
			).toContain("2 pending");

			await input.fill("settings");
			expect(await primary.getByRole("option").count()).toBe(1);
			expect(await settings.isVisible()).toBe(true);
			await input.fill("");
			await settings.click();
			expect(page.url()).toEndWith("#settings");
			expect((await fixture()).navigations).toEqual(["#settings:mouse"]);

			const sync = primary.getByRole("option", { name: /Sync now/ });
			await sync.click();
			expect(await sync.getAttribute("data-pending")).not.toBeNull();
			expect(await sync.getAttribute("aria-busy")).toBe("true");
			await sync.click({ force: true });
			expect((await fixture()).actionSources).toEqual(["mouse"]);
			const pendingAgent = await page.evaluate(async () => {
				const value = window as unknown as CommandFixtureWindow;
				const command = value.agent
					.snapshot()
					.find((component) => component.component === "command");
				if (!command) throw new Error("Command was not exposed to the agent");
				return value.agent.act({
					steps: [{ action: "press", args: ["Sync now"], ref: command.ref }],
				});
			});
			expect(pendingAgent.ok).toBe(false);
			await page.evaluate(() =>
				(window as unknown as CommandFixtureWindow).resolveAction(),
			);
			await page.waitForFunction(
				(element) => element !== null && !element.hasAttribute("data-pending"),
				await sync.elementHandle(),
			);
			const agentAction = await page.evaluate(async () => {
				const value = window as unknown as CommandFixtureWindow;
				const command = value.agent
					.snapshot()
					.find((component) => component.component === "command");
				if (!command) throw new Error("Command was not exposed to the agent");
				return value.agent.act({
					steps: [{ action: "press", args: ["Run report"], ref: command.ref }],
				});
			});
			expect(agentAction.ok).toBe(true);
			expect((await fixture()).actionSources).toEqual([
				"mouse",
				"report:agent",
			]);
			await input.fill("sync");
			await input.focus();
			await input.press("Enter");
			expect((await fixture()).actionSources).toEqual([
				"mouse",
				"report:agent",
				"keyboard",
			]);
			await page.evaluate(() =>
				(window as unknown as CommandFixtureWindow).resolveAction(),
			);
			await page.waitForFunction(
				(element) => element !== null && !element.hasAttribute("data-pending"),
				await sync.elementHandle(),
			);
			await input.fill("");

			const disabled = primary.getByRole("option", {
				name: "Unavailable action",
			});
			expect(await disabled.getAttribute("aria-disabled")).toBe("true");
			await disabled.click({ force: true });
			expect((await fixture()).actionSources).not.toContain("disabled");

			const destructive = primary.getByRole("option", { name: "Sign out" });
			const confirmation = page.getByRole("alertdialog", {
				name: "Sign out of Tripwire?",
			});
			await destructive.click();
			await confirmation.getByRole("button", { name: "Cancel" }).click();
			await confirmation.waitFor({ state: "hidden" });
			expect((await fixture()).destructiveCount).toBe(0);
			await destructive.click();
			await confirmation.waitFor();
			await confirmation.getByRole("button", { name: "Sign out" }).click();
			await confirmation.waitFor({ state: "hidden" });
			expect((await fixture()).destructiveCount).toBe(1);
			const rejectedDestructive = await page.evaluate(async () => {
				const value = window as unknown as CommandFixtureWindow;
				const command = value.agent
					.snapshot()
					.find((component) => component.component === "command");
				if (!command) throw new Error("Command was not exposed to the agent");
				return value.agent.act({
					steps: [{ action: "press", args: ["Sign out"], ref: command.ref }],
				});
			});
			expect(rejectedDestructive.ok).toBe(false);
			expect((await fixture()).destructiveCount).toBe(1);
			await page.evaluate(() => {
				(window as unknown as CommandFixtureWindow).allowDestructive = true;
			});
			const acceptedDestructive = await page.evaluate(async () => {
				const value = window as unknown as CommandFixtureWindow;
				const command = value.agent
					.snapshot()
					.find((component) => component.component === "command");
				if (!command) throw new Error("Command was not exposed to the agent");
				return value.agent.act({
					steps: [{ action: "press", args: ["Sign out"], ref: command.ref }],
				});
			});
			expect(acceptedDestructive.ok).toBe(true);
			expect((await fixture()).destructiveCount).toBe(2);

			await page.getByRole("button", { name: "Toggle loading" }).click();
			expect(await list.getAttribute("aria-busy")).toBe("true");
			expect(
				await primary
					.getByRole("status")
					.getByText("Loading destinations")
					.count(),
			).toBe(1);
			await page.getByRole("button", { name: "Toggle loading" }).click();
			expect(await list.getAttribute("aria-busy")).toBeNull();

			const controlled = page.getByRole("combobox", {
				name: "Controlled search",
			});
			expect(await controlled.inputValue()).toBe("fixed");
			await controlled.fill("changed");
			expect(await controlled.inputValue()).toBe("fixed");
			expect((await fixture()).controlledQueries.at(-1)?.query).toBe("changed");

			const trigger = page.getByRole("button", { name: "Open palette" });
			await trigger.click();
			const dialog = page.getByRole("dialog", { name: "Command palette" });
			const dialogInput = dialog.getByRole("combobox", {
				name: "Dialog search",
			});
			await dialog.waitFor();
			expect(
				await dialogInput.evaluate(
					(element) => document.activeElement === element,
				),
			).toBe(true);
			await page.waitForTimeout(200);
			const dialogBounds = await dialog.boundingBox();
			expect(dialogBounds?.width).toBeCloseTo(640, 1);
			const dialogGeometry = await dialog.evaluate((element) => {
				const bounds = (slot: string) =>
					element
						.querySelector(`[data-slot="${slot}"]`)
						?.getBoundingClientRect();
				return {
					statusHeight: bounds("command-status")?.height,
					emptyHeight: bounds("command-empty")?.height,
					afterRow:
						(bounds("command-panel")?.bottom ?? 0) -
						(bounds("command-item")?.bottom ?? 0),
				};
			});
			expect(dialogGeometry.statusHeight).toBe(0);
			expect(dialogGeometry.emptyHeight ?? 0).toBe(0);
			expect(dialogGeometry.afterRow).toBeLessThanOrEqual(5);
			expect(dialogBounds?.y).toBeCloseTo(144, 1);
			expect(
				await dialog
					.locator('[data-slot="command-input-wrapper"]')
					.evaluate((element) => getComputedStyle(element).borderBottomWidth),
			).toBe("1px");
			await page.keyboard.press("Escape");
			await dialog.waitFor({ state: "hidden" });
			expect(
				await trigger.evaluate((element) => document.activeElement === element),
			).toBe(true);

			const themeSurfaces: string[] = [];
			for (const width of [390, 768, 1280, 1920]) {
				await page.setViewportSize({ height: 720, width });
				for (const theme of ["light", "dark"] as const) {
					await page.locator("body").evaluate((element, nextTheme) => {
						element.setAttribute("data-theme", nextTheme);
					}, theme);
					await trigger.click();
					await page.waitForTimeout(200);
					const bounds = await dialog.boundingBox();
					expect(bounds).not.toBeNull();
					expect((bounds?.x ?? 0) >= 0).toBe(true);
					expect((bounds?.x ?? 0) + (bounds?.width ?? 0) <= width).toBe(true);
					const surface = await dialog.evaluate((element) => {
						const style = getComputedStyle(element);
						return {
							background: style.backgroundColor,
							border: style.borderTopColor,
							color: style.color,
						};
					});
					expect(surface.background).not.toBe("rgba(0, 0, 0, 0)");
					expect(surface.border).not.toBe("rgba(0, 0, 0, 0)");
					expect(surface.color).not.toBe("rgba(0, 0, 0, 0)");
					if (width === 1280) themeSurfaces.push(surface.background);
					await page.keyboard.press("Escape");
					await dialog.waitFor({ state: "hidden" });
				}
			}
			expect(themeSurfaces[0]).not.toBe(themeSurfaces[1]);

			await page.emulateMedia({ reducedMotion: "reduce" });
			await trigger.click();
			expect(
				await dialog.evaluate(
					(element) => getComputedStyle(element).transitionDuration,
				),
			).toBe("0s");
			await page.keyboard.press("Escape");
			await dialog.waitFor({ state: "hidden" });

			await page.emulateMedia({
				forcedColors: "active",
				reducedMotion: "no-preference",
			});
			await input.fill("");
			await input.press("ArrowDown");
			const highlighted = primary.locator(
				'[data-slot="command-item"][data-highlighted]',
			);
			expect(await highlighted.count()).toBe(1);
			const forcedColors = await highlighted.evaluate((element) => {
				const actual = getComputedStyle(element);
				return {
					actualColor: actual.color,
					actualForcedColorAdjust: actual.forcedColorAdjust,
					actualOutline: actual.outlineColor,
					actualOutlineStyle: actual.outlineStyle,
					actualOutlineWidth: actual.outlineWidth,
				};
			});
			expect(forcedColors.actualForcedColorAdjust).toBe("none");
			expect(forcedColors.actualColor).not.toBe("rgba(0, 0, 0, 0)");
			expect(forcedColors.actualOutline).not.toBe("rgba(0, 0, 0, 0)");
			expect(forcedColors.actualOutlineStyle).toBe("solid");
			expect(forcedColors.actualOutlineWidth).toBe("1px");
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
