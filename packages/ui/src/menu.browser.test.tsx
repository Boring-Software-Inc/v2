import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface MenuFixtureWindow extends Window {
	actionSources: string[];
	agentApproval: boolean;
	agent: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{ component: string; ref: string }>;
	};
	checkboxChanges: Array<{ checked: boolean; source: string }>;
	controlledOpenChanges: Array<{ open: boolean; source: string }>;
	linkSources: string[];
	pendingCalls: number;
	radioChanges: Array<{ source: string; value: string }>;
	resolvePending?: () => void;
}

test("menus preserve keyboard, pending, controlled, confirmation, and agent behavior", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-menu-"));
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
			import { createElement, Fragment } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { Button } from ${JSON.stringify(fileURLToPath(new URL("./button.tsx", import.meta.url)))};
			import { ButtonGroup, ButtonGroupMenu } from ${JSON.stringify(fileURLToPath(new URL("./button-group.tsx", import.meta.url)))};
			import { Menu } from ${JSON.stringify(fileURLToPath(new URL("./menu.tsx", import.meta.url)))};
			import { OverlayHost } from ${JSON.stringify(fileURLToPath(new URL("./overlays.tsx", import.meta.url)))};

			window.actionSources = [];
			window.agentApproval = false;
			window.checkboxChanges = [];
			window.controlledOpenChanges = [];
			window.linkSources = [];
			window.pendingCalls = 0;
			window.radioChanges = [];
			window.agent = createAgent({
				allow: (step) => !step.confirm || window.agentApproval,
			});
			const icon = createElement("svg", { "aria-hidden": "true", viewBox: "0 0 16 16" }, createElement("path", { d: "M2 8h12" }));

			const items = [
				{
					badge: { label: "Personal" },
					description: "owner@example.com",
					label: "Current workspace",
					selected: true,
					type: "summary",
					value: "summary",
				},
				{
					icon,
					label: "Open",
					onAction: (details) => window.actionSources.push(details.source),
					shortcut: "Ctrl O",
					value: "open",
				},
				{
					disabled: true,
					label: "Locked",
					onAction: (details) => window.actionSources.push(details.source),
					value: "locked",
				},
				{
					checked: false,
					description: "Toggle the layout grid",
					label: "Grid",
					onCheckedChange: (checked, details) => window.checkboxChanges.push({ checked, source: details.source }),
					type: "checkbox",
					value: "grid",
				},
				{
					closeOnSelect: true,
					defaultValue: "comfortable",
					label: "Density",
					onValueChange: (value, details) => window.radioChanges.push({ source: details.source, value }),
					options: [
						{
							description: "Use less space",
							label: "Compact",
							value: "compact",
						},
						{ label: "Comfortable", value: "comfortable" },
					],
					type: "radio-group",
					valueKey: "density",
				},
				{
					href: "/docs",
					label: "Documentation",
					onNavigate: (_href, details) => window.linkSources.push(details.source),
					openInNewTab: true,
					type: "link",
					value: "docs",
				},
				{
					label: "Sync",
					onAction: () => {
						window.pendingCalls += 1;
						return new Promise((resolve) => { window.resolvePending = resolve; });
					},
					value: "sync",
				},
				{
					confirmation: {
						confirmLabel: "Delete",
						description: "This cannot be undone.",
						title: "Delete workspace?",
					},
					label: "Delete",
					onAction: (details) => window.actionSources.push(details.source),
					tone: "destructive",
					value: "delete",
				},
			];

			createRoot(document.getElementById("root")).render(
				createElement(Fragment, null,
					createElement(Menu, {
						ariaLabel: "Actions",
						items,
						onOpenChange: (open, details) => window.controlledOpenChanges.push({ open, source: details.source }),
						trigger: createElement("button", { type: "button" }, "Actions"),
						width: "popover",
					}),
					createElement(Menu, {
						ariaLabel: "Controlled actions",
						items: [{ label: "Controlled action", onAction: () => {}, value: "controlled" }],
						onOpenChange: (open, details) => window.controlledOpenChanges.push({ open, source: details.source }),
						open: false,
						trigger: createElement("button", { type: "button" }, "Controlled"),
					}),
					createElement(ButtonGroup, { "aria-label": "Create options" },
						createElement(Button, { onAction: () => {} }, "Create something with a long label"),
						createElement(ButtonGroupMenu, {
							align: "start",
							items: [{ label: "Blank", onAction: () => {}, value: "blank" }],
							label: "Template options",
						}),
					),
					createElement(OverlayHost),
				),
			);
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
			throw new Error("Menu browser fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://menu.test/client.js") {
					await route.fulfill({ body: bundle, contentType: "text/javascript" });
					return;
				}
				if (url === "http://menu.test/client.css") {
					await route.fulfill({ body: styles, contentType: "text/css" });
					return;
				}
				if (url === "http://menu.test/") {
					await route.fulfill({
						body: '<body class="tripwire" data-system="tripwire" data-theme="light"><link rel="stylesheet" href="/client.css"><div id="root"></div><script type="module" src="/client.js"></script></body>',
						contentType: "text/html",
					});
					return;
				}
				await route.abort();
			});

			const page = await context.newPage();
			page.setDefaultTimeout(2_000);
			await page.goto("http://menu.test/");
			await page.emulateMedia({ reducedMotion: "reduce" });
			const trigger = page.getByRole("button", {
				exact: true,
				name: "Actions",
			});
			const controlledTrigger = page.getByRole("button", {
				exact: true,
				name: "Controlled actions",
			});
			const actionSources = () =>
				page.evaluate<string[]>(() => [
					...(window as unknown as MenuFixtureWindow).actionSources,
				]);

			const split = page.getByRole("group", { name: "Create options" });
			const splitTrigger = split.getByRole("button", {
				name: "Template options",
			});
			const splitAction = split.getByRole("button", {
				name: "Create something with a long label",
			});
			expect(
				await splitAction.evaluate(
					(element) => getComputedStyle(element).borderStartEndRadius,
				),
			).toBe("0px");
			expect(
				await splitTrigger.evaluate(
					(element) => getComputedStyle(element).borderStartStartRadius,
				),
			).toBe("0px");
			await splitTrigger.press("Enter");
			const splitMenu = page.getByRole("menu");
			await splitMenu.waitFor();
			const caret = splitTrigger.locator(
				'[data-slot="button-group-menu-chevron"]',
			);
			await page.waitForFunction(() => {
				const element = document.querySelector(
					'[data-slot="button-group-menu-chevron"]',
				);
				return element && getComputedStyle(element).rotate === "180deg";
			});
			expect(await caret.count()).toBe(1);
			const groupBounds = await split.boundingBox();
			if (!groupBounds) throw new Error("Split button is absent");
			await page.waitForFunction((x) => {
				const menu = document.querySelector("[role=menu]");
				if (!menu) return false;
				const scale = getComputedStyle(menu).scale;
				return (
					(scale === "none" || scale === "1") &&
					Math.abs(menu.getBoundingClientRect().x - x) < 1
				);
			}, groupBounds.x);
			expect((await splitMenu.boundingBox())?.width).toBeGreaterThanOrEqual(
				groupBounds.width - 1,
			);
			await page.keyboard.press("Escape");
			await splitMenu.waitFor({ state: "hidden" });
			expect(
				await splitTrigger.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);

			await controlledTrigger.click();
			expect(
				await page.getByRole("menuitem", { name: "Controlled action" }).count(),
			).toBe(0);
			expect(
				await page.evaluate(() =>
					(window as unknown as MenuFixtureWindow).controlledOpenChanges.at(-1),
				),
			).toEqual({ open: true, source: "mouse" });

			await trigger.click();
			const summary = page.locator('[data-slot="menu-summary"]');
			await summary.waitFor();
			expect(await summary.getAttribute("data-selected")).toBe("");
			expect(await summary.getAttribute("data-has-description")).toBe("");
			expect(await summary.getByText("Personal").count()).toBe(1);
			expect(await page.getByText("Ctrl O").count()).toBe(1);

			const openItem = page.getByRole("menuitem", { name: "Open" });
			const lockedItem = page.getByRole("menuitem", { name: "Locked" });
			const checkbox = page.getByRole("menuitemcheckbox", { name: "Grid" });
			expect(await checkbox.getAttribute("data-has-description")).toBe("");
			const opticalAlignment = await page.evaluate(() => {
				const itemIcon = document.querySelector<SVGElement>(
					'[data-slot="menu-item-icon"] svg',
				);
				const indicator = document.querySelector<SVGElement>(
					'[data-slot="menu-item-indicator"] svg',
				);
				const plainLabel = [
					...document.querySelectorAll<HTMLElement>(
						'[data-slot="menu-item-label"]',
					),
				].find((element) => element.textContent === "Locked");
				if (!(itemIcon && indicator && plainLabel)) return null;
				return {
					iconX: itemIcon.getBoundingClientRect().x,
					indicatorX: indicator.getBoundingClientRect().x,
					plainLabelX: plainLabel.getBoundingClientRect().x,
				};
			});
			expect(opticalAlignment).not.toBeNull();
			expect(opticalAlignment?.iconX).toBeCloseTo(
				opticalAlignment?.indicatorX ?? 0,
				1,
			);
			expect(opticalAlignment?.iconX).toBeCloseTo(
				opticalAlignment?.plainLabelX ?? 0,
				1,
			);
			expect(
				await openItem.evaluate(
					(element) => getComputedStyle(element).paddingLeft,
				),
			).toBe("8px");
			expect(
				await lockedItem.evaluate(
					(element) => getComputedStyle(element).paddingLeft,
				),
			).toBe("8px");
			expect(
				await summary.evaluate(
					(element) => getComputedStyle(element).paddingLeft,
				),
			).toBe("8px");
			expect(
				await checkbox.evaluate(
					(element) => getComputedStyle(element).paddingLeft,
				),
			).toBe("28px");
			expect(
				await page
					.getByRole("menuitemradio", { name: "Compact" })
					.evaluate((element) => getComputedStyle(element).paddingLeft),
			).toBe("28px");
			await openItem.focus();
			await openItem.press("ArrowDown");
			expect(
				await lockedItem.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);
			await lockedItem.press("Enter");
			expect(await actionSources()).toEqual([]);
			await lockedItem.press("ArrowDown");
			await checkbox.press("d");
			expect(
				await page
					.getByRole("menuitem", { name: "Documentation" })
					.evaluate((element) => element === document.activeElement),
			).toBe(true);
			await page.keyboard.press("Escape");
			await page.waitForTimeout(200);
			expect(await page.getByRole("menu").count()).toBe(0);
			expect(
				await trigger.evaluate((element) => element === document.activeElement),
			).toBe(true);
			await trigger.press("Enter");

			await checkbox.press("Enter");
			expect(await checkbox.getAttribute("aria-checked")).toBe("false");
			expect(
				await page.evaluate(
					() => (window as unknown as MenuFixtureWindow).checkboxChanges,
				),
			).toEqual([{ checked: true, source: "keyboard" }]);
			expect(await page.getByRole("menu").count()).toBe(1);

			const compact = page.getByRole("menuitemradio", { name: "Compact" });
			expect(await compact.getAttribute("data-has-description")).toBe("");
			await compact.click();
			await page.getByRole("menu").waitFor({ state: "hidden" });
			expect(
				await trigger.evaluate((element) => element === document.activeElement),
			).toBe(true);
			await trigger.press("Enter");
			await compact.waitFor();
			expect(await compact.getAttribute("aria-checked")).toBe("true");
			expect(
				await page.evaluate(
					() => (window as unknown as MenuFixtureWindow).radioChanges,
				),
			).toEqual([{ source: "mouse", value: "compact" }]);

			const docs = page.getByRole("menuitem", { name: "Documentation" });
			expect(await docs.getAttribute("target")).toBe("_blank");
			expect(await docs.getAttribute("rel")).toBe("noreferrer");
			await docs.click();
			expect(
				await page.evaluate(
					() => (window as unknown as MenuFixtureWindow).linkSources,
				),
			).toEqual(["mouse"]);

			const sync = page.getByRole("menuitem", { name: "Sync" });
			await sync.click();
			expect(await sync.getAttribute("aria-busy")).toBe("true");
			await sync.click({ force: true });
			expect(
				await page.evaluate(
					() => (window as unknown as MenuFixtureWindow).pendingCalls,
				),
			).toBe(1);
			await page.evaluate(() =>
				(window as unknown as MenuFixtureWindow).resolvePending?.(),
			);
			await page.locator('[role="menu"]').waitFor({ state: "detached" });
			expect(
				await trigger.evaluate((element) => element === document.activeElement),
			).toBe(true);

			await trigger.press("Enter");
			const deleteItem = page.getByRole("menuitem", { name: "Delete" });
			await deleteItem.click();
			const dialog = page.getByRole("alertdialog", {
				name: "Delete workspace?",
			});
			expect(await deleteItem.getAttribute("aria-busy")).toBe("true");
			await dialog.getByRole("button", { name: "Cancel" }).click();
			expect(await actionSources()).toEqual([]);
			await dialog.waitFor({ state: "detached" });
			await page.locator('[role="menu"]').waitFor({ state: "detached" });

			await trigger.click();
			await page.getByRole("menuitem", { name: "Delete" }).click();
			await dialog.getByRole("button", { name: "Delete" }).click();
			expect(await actionSources()).toEqual(["mouse"]);
			await dialog.waitFor({ state: "detached" });
			await page.locator('[role="menu"]').waitFor({ state: "detached" });

			await trigger.press("Enter");
			const keyboardDelete = page.getByRole("menuitem", { name: "Delete" });
			await keyboardDelete.focus();
			await keyboardDelete.press("Enter");
			await dialog.getByRole("button", { name: "Cancel" }).click();
			expect(await actionSources()).toEqual(["mouse"]);
			await dialog.waitFor({ state: "detached" });
			await page.locator('[role="menu"]').waitFor({ state: "detached" });

			const agentResults = await page.evaluate(async () => {
				const fixtureWindow = window as unknown as MenuFixtureWindow;
				const menu = fixtureWindow.agent
					.snapshot()
					.find((entry) => entry.component === "menu");
				if (!menu) throw new Error("Menu was not exposed to the agent");
				const opened = await fixtureWindow.agent.act({
					steps: [{ action: "setOpen", args: [true], ref: menu.ref }],
				});
				const openedItem = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: ["Open"], ref: menu.ref }],
				});
				const refusedDelete = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: ["Delete"], ref: menu.ref }],
				});
				const sourcesAfterRefusal = [...fixtureWindow.actionSources];
				fixtureWindow.agentApproval = true;
				const approvedDelete = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: ["Delete"], ref: menu.ref }],
				});
				return {
					results: [opened, openedItem, refusedDelete, approvedDelete],
					sourcesAfterRefusal,
				};
			});
			expect(agentResults.results.map((result) => result.ok)).toEqual([
				true,
				true,
				false,
				true,
			]);
			expect(agentResults.sourcesAfterRefusal).toEqual(["mouse", "agent"]);
			await page.waitForTimeout(200);
			expect(await page.getByRole("alertdialog").count()).toBe(0);
			expect(await actionSources()).toEqual(["mouse", "agent", "agent"]);
			expect(
				await page.evaluate(() =>
					(window as unknown as MenuFixtureWindow).controlledOpenChanges.find(
						(change) => change.source === "agent" && change.open,
					),
				),
			).toEqual({ open: true, source: "agent" });

			await page.emulateMedia({
				forcedColors: "none",
				reducedMotion: "no-preference",
			});
			const themeSurfaces: string[] = [];
			for (const width of [390, 768, 1280, 1920]) {
				await page.setViewportSize({ height: 720, width });
				for (const theme of ["light", "dark"] as const) {
					await page.locator("body").evaluate((element, nextTheme) => {
						element.setAttribute("data-theme", nextTheme);
					}, theme);
					await trigger.click();
					const content = page.getByRole("menu");
					await content.waitFor();
					await page.waitForTimeout(150);
					const bounds = await content.boundingBox();
					expect(bounds).not.toBeNull();
					expect(bounds?.width).toBeCloseTo(288, 0);
					expect((bounds?.x ?? 0) >= 0).toBe(true);
					expect((bounds?.x ?? 0) + (bounds?.width ?? 0) <= width).toBe(true);
					expect((bounds?.y ?? 0) >= 0).toBe(true);
					expect((bounds?.y ?? 0) + (bounds?.height ?? 0) <= 720).toBe(true);
					const surface = await content.evaluate((element) => {
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
					await content.waitFor({ state: "detached" });
				}
			}
			expect(themeSurfaces[0]).not.toBe(themeSurfaces[1]);

			await page.emulateMedia({ reducedMotion: "reduce" });
			await trigger.click();
			const reducedMenu = page.getByRole("menu");
			expect(
				await reducedMenu.evaluate(
					(element) => getComputedStyle(element).transitionDuration,
				),
			).toBe("0s");
			await page.keyboard.press("Escape");
			await reducedMenu.waitFor({ state: "detached" });

			await page.emulateMedia({
				forcedColors: "active",
				reducedMotion: "no-preference",
			});
			await trigger.click();
			const forcedMenu = page.getByRole("menu");
			const forcedItem = forcedMenu.getByRole("menuitem", { name: "Open" });
			await forcedItem.focus();
			const forcedColors = await forcedItem.evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					color: style.color,
					forcedColorAdjust: style.forcedColorAdjust,
					outlineColor: style.outlineColor,
					outlineStyle: style.outlineStyle,
					outlineWidth: style.outlineWidth,
				};
			});
			expect(forcedColors.forcedColorAdjust).toBe("none");
			expect(forcedColors.color).not.toBe("rgba(0, 0, 0, 0)");
			expect(forcedColors.outlineColor).not.toBe("rgba(0, 0, 0, 0)");
			expect(forcedColors.outlineStyle).toBe("solid");
			expect(forcedColors.outlineWidth).toBe("1px");
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
